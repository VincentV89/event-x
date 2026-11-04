import * as path from 'node:path';
import * as fs from 'node:fs';
import {
  CfnOutput, Duration, RemovalPolicy, Stack, StackProps,
  aws_apigateway as apigateway,
  aws_apigatewayv2 as apigw,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as origins,
  aws_cognito as cognito,
  aws_dynamodb as dynamodb,
  aws_iam as iam,
  aws_lambda as lambda,
  aws_lambda_nodejs as nodejs,
  aws_logs as logs,
  aws_s3 as s3,
  aws_s3_deployment as s3deploy,
} from 'aws-cdk-lib';
import { HttpUserPoolAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Construct } from 'constructs';

const ROOT = path.join(__dirname, '..', '..');
const ORGANIZER_GROUP = 'organizers';

export interface EventXStackProps extends StackProps {
  /** Path to the built frontend. Skipped (useful for unit tests) when the folder does not exist. */
  frontendDistPath?: string;
  /** Extra allowed origins for local development (CORS + OAuth callback). */
  devOrigins?: string[];
}

export class EventXStack extends Stack {
  constructor(scope: Construct, id: string, props: EventXStackProps = {}) {
    super(scope, id, props);
    const devOrigins = props.devOrigins ?? ['http://localhost:5173'];
    const frontendDist = props.frontendDistPath ?? path.join(ROOT, 'frontend', 'dist');
    // Short, stable, account/region-unique suffix for globally unique names.
    const suffix = this.node.addr.substring(0, 8);

    // ---------------- Data ----------------
    const table = new dynamodb.TableV2(this, 'EventTable', {
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.DESTROY, // development stack - `cdk destroy` removes all data
      globalSecondaryIndexes: [
        {
          // Sparse index: only event META items carry GSI1PK, so attendee PII never lands here.
          indexName: 'GSI1',
          partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
          sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
        },
      ],
    });

    // ---------------- Frontend hosting ----------------
    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      bucketName: `eventx-site-${this.account}-${this.region}-${suffix}`.toLowerCase(),
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const securityHeaders = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeaders', {
      securityHeadersBehavior: {
        contentSecurityPolicy: {
          override: true,
          contentSecurityPolicy: [
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: https:",
            "font-src 'self' data:",
            `connect-src 'self' https://*.execute-api.${this.region}.amazonaws.com https://*.auth.${this.region}.amazoncognito.com`,
            "frame-ancestors 'none'",
            "base-uri 'self'",
            "form-action 'self' https://*.amazoncognito.com",
          ].join('; '),
        },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN, override: true },
        strictTransportSecurity: { accessControlMaxAge: Duration.days(365), includeSubdomains: true, override: true },
      },
    });

    const distribution = new cloudfront.Distribution(this, 'SiteDistribution', {
      comment: 'EventX web app',
      defaultRootObject: 'index.html',
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: securityHeaders,
        compress: true,
      },
      // Single-page app: let the React router handle deep links.
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: Duration.seconds(0) },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: Duration.seconds(0) },
      ],
    });
    const siteUrl = `https://${distribution.distributionDomainName}`;

    // ---------------- Identity (organizers) ----------------
    const userPool = new cognito.UserPool(this, 'OrganizerPool', {
      userPoolName: `eventx-organizers-${suffix}`,
      selfSignUpEnabled: false, // organizers are invited by an administrator only
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: true } },
      passwordPolicy: {
        minLength: 12, requireLowercase: true, requireUppercase: true, requireDigits: true, requireSymbols: true,
        tempPasswordValidity: Duration.days(3),
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      featurePlan: cognito.FeaturePlan.LITE,
      userInvitation: {
        emailSubject: 'Your EventX organizer account',
        emailBody:
          'You have been invited as an EventX organizer. Username: {username} Temporary password: {####} ' +
          `Sign in at ${siteUrl}/organizer - you will be asked to choose a new password.`,
      },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    new cognito.CfnUserPoolGroup(this, 'OrganizersGroup', {
      userPoolId: userPool.userPoolId,
      groupName: ORGANIZER_GROUP,
      description: 'Event organizers - may view attendees and cancel registrations',
    });

    const domain = userPool.addDomain('HostedUiDomain', {
      cognitoDomain: { domainPrefix: `eventx-${this.account}-${suffix}`.toLowerCase() },
    });

    const userPoolClient = userPool.addClient('WebClient', {
      userPoolClientName: 'eventx-web',
      generateSecret: false, // browser app - PKCE authorization code flow
      authFlows: { userSrp: true, adminUserPassword: true }, // admin flow = server-side only (IAM), used by smoke tests
      preventUserExistenceErrors: true,
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        callbackUrls: [`${siteUrl}/callback`, ...devOrigins.map((o) => `${o}/callback`)],
        logoutUrls: [`${siteUrl}/`, ...devOrigins.map((o) => `${o}/`)],
      },
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(1),
      enableTokenRevocation: true,
    });

    // ---------------- Backend ----------------
    const fnDefaults: Partial<nodejs.NodejsFunctionProps> = {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: Duration.seconds(10),
      projectRoot: ROOT,
      depsLockFilePath: path.join(ROOT, 'package-lock.json'),
      environment: { TABLE_NAME: table.tableName, ORGANIZER_GROUP, NODE_OPTIONS: '--enable-source-maps' },
      bundling: { minify: true, sourceMap: true, target: 'node22', externalModules: ['@aws-sdk/*'] },
      tracing: lambda.Tracing.DISABLED,
    };

    const mkLogGroup = (id: string) =>
      new logs.LogGroup(this, id, { retention: logs.RetentionDays.TWO_WEEKS, removalPolicy: RemovalPolicy.DESTROY });

    const publicFn = new nodejs.NodejsFunction(this, 'PublicApiFn', {
      ...fnDefaults,
      description: 'EventX public API - event info, aggregate counts, registration',
      entry: path.join(ROOT, 'backend', 'src', 'public.ts'),
      handler: 'handler',
      logGroup: mkLogGroup('PublicApiLogs'),
    });

    const adminFn = new nodejs.NodejsFunction(this, 'AdminApiFn', {
      ...fnDefaults,
      description: 'EventX organizer API - attendee list and cancellations (Cognito protected)',
      entry: path.join(ROOT, 'backend', 'src', 'admin.ts'),
      handler: 'handler',
      logGroup: mkLogGroup('AdminApiLogs'),
    });

    // Least-privilege IAM: explicit actions only, no table-wide wildcards.
    const gsiArn = `${table.tableArn}/index/GSI1`;
    publicFn.addToRolePolicy(new iam.PolicyStatement({
      sid: 'ReadEventsIndex', actions: ['dynamodb:Query'], resources: [gsiArn],
    }));
    publicFn.addToRolePolicy(new iam.PolicyStatement({
      sid: 'RegisterAttendee',
      // Transactions are authorized per underlying item operation. No Query/Scan on the base
      // table, so this function cannot enumerate attendee records.
      actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:ConditionCheckItem'],
      resources: [table.tableArn],
    }));
    adminFn.addToRolePolicy(new iam.PolicyStatement({
      sid: 'ReadEventsIndex', actions: ['dynamodb:Query'], resources: [gsiArn],
    }));
    adminFn.addToRolePolicy(new iam.PolicyStatement({
      sid: 'ManageRegistrations',
      actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem', 'dynamodb:ConditionCheckItem'],
      resources: [table.tableArn],
    }));

    const httpApi = new apigw.HttpApi(this, 'HttpApi', {
      apiName: `eventx-api-${suffix}`,
      description: 'EventX REST API',
      createDefaultStage: false,
      corsPreflight: {
        allowOrigins: [siteUrl, ...devOrigins],
        allowMethods: [apigw.CorsHttpMethod.GET, apigw.CorsHttpMethod.POST, apigw.CorsHttpMethod.DELETE, apigw.CorsHttpMethod.OPTIONS],
        allowHeaders: ['content-type', 'authorization'],
        maxAge: Duration.hours(1),
      },
    });

    const accessLogs = new logs.LogGroup(this, 'ApiAccessLogs', {
      retention: logs.RetentionDays.TWO_WEEKS, removalPolicy: RemovalPolicy.DESTROY,
    });
    const stage = new apigw.HttpStage(this, 'DefaultStage', {
      httpApi,
      stageName: '$default',
      autoDeploy: true,
      throttle: { rateLimit: 50, burstLimit: 100 },
      accessLogSettings: {
        destination: new apigw.LogGroupLogDestination(accessLogs),
        // No source IP, user agent or bodies - operational fields only.
        format: apigateway.AccessLogFormat.custom(JSON.stringify({
          requestId: '$context.requestId',
          time: '$context.requestTime',
          routeKey: '$context.routeKey',
          status: '$context.status',
          latencyMs: '$context.responseLatency',
          integrationError: '$context.integrationErrorMessage',
          authorizerError: '$context.authorizer.error',
        })),
      },
    });

    const publicIntegration = new HttpLambdaIntegration('PublicIntegration', publicFn);
    const adminIntegration = new HttpLambdaIntegration('AdminIntegration', adminFn);
    const authorizer = new HttpUserPoolAuthorizer('OrganizerAuthorizer', userPool, {
      userPoolClients: [userPoolClient],
      identitySource: ['$request.header.Authorization'],
    });

    httpApi.addRoutes({ path: '/events', methods: [apigw.HttpMethod.GET], integration: publicIntegration });
    httpApi.addRoutes({ path: '/events/{eventId}', methods: [apigw.HttpMethod.GET], integration: publicIntegration });
    httpApi.addRoutes({ path: '/events/{eventId}/registrations', methods: [apigw.HttpMethod.POST], integration: publicIntegration });
    httpApi.addRoutes({ path: '/admin/events', methods: [apigw.HttpMethod.GET], integration: adminIntegration, authorizer });
    httpApi.addRoutes({
      path: '/admin/events/{eventId}/registrations', methods: [apigw.HttpMethod.GET], integration: adminIntegration, authorizer,
    });
    httpApi.addRoutes({
      path: '/admin/events/{eventId}/registrations/{confirmationId}', methods: [apigw.HttpMethod.DELETE],
      integration: adminIntegration, authorizer,
    });

    const apiUrl = stage.url.replace(/\/$/, '');
    const cognitoDomainUrl = domain.baseUrl();

    // ---------------- Deploy the frontend + runtime config ----------------
    if (fs.existsSync(path.join(frontendDist, 'index.html'))) {
      new s3deploy.BucketDeployment(this, 'DeploySite', {
        sources: [
          s3deploy.Source.asset(frontendDist, { exclude: ['config.json'] }),
          // Runtime config generated from stack values - the frontend is wired to the backend automatically.
          s3deploy.Source.jsonData('config.json', {
            apiUrl: stage.url,
            region: this.region,
            userPoolId: userPool.userPoolId,
            userPoolClientId: userPoolClient.userPoolClientId,
            cognitoDomain: cognitoDomainUrl,
          }),
        ],
        destinationBucket: siteBucket,
        distribution,
        distributionPaths: ['/*'],
        memoryLimit: 512,
        prune: true,
      });
    }

    // ---------------- Outputs ----------------
    new CfnOutput(this, 'WebsiteUrl', { value: siteUrl });
    new CfnOutput(this, 'ApiUrl', { value: apiUrl });
    new CfnOutput(this, 'TableName', { value: table.tableName });
    new CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: userPoolClient.userPoolClientId });
    new CfnOutput(this, 'CognitoDomain', { value: cognitoDomainUrl });
    new CfnOutput(this, 'OrganizerGroup', { value: ORGANIZER_GROUP });
    new CfnOutput(this, 'SiteBucketName', { value: siteBucket.bucketName });
    new CfnOutput(this, 'DistributionId', { value: distribution.distributionId });
  }
}
