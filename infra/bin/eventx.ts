#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { EventXStack } from '../lib/eventx-stack';

const app = new App();
const stackName: string = app.node.tryGetContext('stackName') ?? 'EventX';
const region = process.env.CDK_DEFAULT_REGION ?? process.env.AWS_REGION ?? 'us-east-1';

new EventXStack(app, 'EventX', {
  stackName,
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region },
  description: 'EventX - serverless event registration platform (S3, CloudFront, API Gateway, Lambda, DynamoDB, Cognito)',
  tags: { Application: 'EventX', Environment: 'development' },
});
