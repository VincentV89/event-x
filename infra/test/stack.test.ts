import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { EventXStack } from '../lib/eventx-stack';

const app = new App();
const stack = new EventXStack(app, 'Test', {
  env: { account: '111111111111', region: 'us-east-1' },
  frontendDistPath: '/nonexistent',
});
const t = Template.fromStack(stack);

describe('EventXStack', () => {
  it('uses on-demand DynamoDB with PITR', () => {
    t.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      BillingMode: 'PAY_PER_REQUEST',
      Replicas: Match.arrayWith([Match.objectLike({ PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true } })]),
    });
  });

  it('keeps the site bucket private behind CloudFront OAC', () => {
    t.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
    });
    t.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
  });

  it('protects every admin route with the Cognito JWT authorizer and leaves public routes open', () => {
    const routes = t.findResources('AWS::ApiGatewayV2::Route');
    const byKey = Object.fromEntries(Object.values(routes).map((r) => [r.Properties.RouteKey, r.Properties]));
    for (const [key, props] of Object.entries(byKey) as Array<[string, { AuthorizationType?: string }]>) {
      if (key.includes('/admin/')) expect(props.AuthorizationType).toBe('JWT');
      else expect(props.AuthorizationType ?? 'NONE').toBe('NONE');
    }
    expect(Object.keys(byKey)).toHaveLength(6);
  });

  it('disables Cognito self sign-up', () => {
    t.hasResourceProperties('AWS::Cognito::UserPool', { AdminCreateUserConfig: { AllowAdminCreateUserOnly: true } });
  });

  it('does not grant the public function Query/Scan on the base table', () => {
    const policies = t.findResources('AWS::IAM::Policy');
    const publicPolicy = Object.entries(policies).find(([k]) => k.startsWith('PublicApiFn'));
    expect(publicPolicy).toBeDefined();
    const stmts = publicPolicy![1].Properties.PolicyDocument.Statement as Array<{ Action: string | string[]; Sid?: string }>;
    const register = stmts.find((s) => s.Sid === 'RegisterAttendee')!;
    expect(register.Action).not.toContain('dynamodb:Query');
    expect(register.Action).not.toContain('dynamodb:Scan');
  });
});
