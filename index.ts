import * as pulumi from "@pulumi/pulumi";
import * as awsx from "@pulumi/awsx";
import * as aws from "@pulumi/aws";

export class HedgeDoc extends pulumi.ComponentResource {

    public readonly hostname: pulumi.Output<string>;

    constructor(public readonly name: string = "hedgedoc1", opts: pulumi.ResourceOptions = {}) {
        super('custom:resource:HedgeDoc', name, {}, opts);

        const cfg = new pulumi.Config();

        const vpc = new awsx.ec2.Vpc(`${name}-vpc`, {
          cidrBlock: "10.0.0.0/24",
          numberOfAvailabilityZones: 1,
          numberOfNatGateways: 1
        });

        const cluster = new awsx.ecs.Cluster(`${name}-cluster`, { vpc });

        const securityGroupIds = cluster.securityGroups.map(g => g.id);

        const dbSubnets = new aws.rds.SubnetGroup(`${name}-dbsubnets`, {
            subnetIds: vpc.publicSubnetIds,
        });

        const db = new aws.rds.Instance(`${name}-db`, {
            name: cfg.get("db_name"),
            username: cfg.get("db_username"),
            password: cfg.getSecret("db_password"),
            allocatedStorage: 20,
            dbSubnetGroupName: dbSubnets.id,
            vpcSecurityGroupIds: securityGroupIds,
            engine: "postgresql",
            engineVersion: "13.2",
            instanceClass: "db.t2.micro",
            storageType: "standard",
            skipFinalSnapshot: true,
            publiclyAccessible: false,
            applyImmediately: true
        });

        const appLoadBalancer = new awsx.lb.ApplicationLoadBalancer(`${name}-lb`, { vpc });
        const targetGroup = appLoadBalancer.createTargetGroup(`${name}-tg`, { port: 3000, vpc });
        const listener = targetGroup.createListener(`${name}-lst`, { port: 80, vpc });

        const distributionArgs: aws.cloudfront.DistributionArgs = {
            enabled: true,
            origins: [
                {
                    originId: appLoadBalancer.loadBalancer.arn,
                    domainName: listener.endpoint.hostname,
                    customOriginConfig: {
                        // Amazon S3 doesn't support HTTPS connections when using an S3 bucket configured as a website endpoint.
                        // https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/distribution-web-values-specify.html#DownloadDistValuesOriginProtocolPolicy
                        originProtocolPolicy: "http-only",
                        httpPort: 80,
                        httpsPort: 443,
                        originSslProtocols: ["TLSv1.2"],
                    },
                },
            ],
            defaultCacheBehavior: {
                targetOriginId: appLoadBalancer.loadBalancer.arn,
                viewerProtocolPolicy: "redirect-to-https",
                allowedMethods: [ "*" ],
                cachedMethods: [ ],
            },
            restrictions: {
                geoRestriction: {
                    restrictionType: "none",
                },
            },
            viewerCertificate: {
                cloudfrontDefaultCertificate: true
            },
            // "All" is the most broad distribution, and also the most expensive.
            // "100" is the least broad, and also the least expensive.
            priceClass: "PriceClass_100",
        };
        const cdn = new aws.cloudfront.Distribution(`${name}-cdn`, distributionArgs);

        const bucket = new aws.s3.Bucket(`${name}-bucket`, {
            acl: "public-read"
        });

        const s3User = new aws.iam.User(`${name}-s3-user`, {
            path: "/system/"
        });

        const s3AccessKey = new aws.iam.AccessKey(`${name}-s3-access-key`, {
            user: s3User.name,
        });

        const bucketPolicy = new aws.s3.BucketPolicy(`${name}-bucket-policy`, {
            bucket: bucket.id,
            policy: bucket.arn.apply(bucketArn => JSON.stringify({
                Version: "2012-10-17",
                Statement: [{
                    Effect: "Allow",
                    Principal: s3User.arn,
                    Action: [
                        "s3:*",
                    ],
                    Resource: [
                        `${bucketArn}/*`,
                    ],
                }],
            })),
        });

        const environment = [
            {
                name: "CMD_DB_URL",
                value: `postgres://${cfg.get("db_username")}:${cfg.getSecret("db_password")}@${db.address}:${db.port}/${cfg.get("db_name")}`
            },
            { name: "CMD_IMAGE_UPLOAD_TYPE", value: "s3" },
            { name: "CMD_DOMAIN", value: cdn.domainName },
            { name: "CMD_PROTOCOL_USESSL", value: "true" },
            { name: "CMD_ALLOW_ORIGIN", value: `['${cdn.domainName}']` },
            { name: "CMD_SESSION_SECRET", value: `${cfg.getSecret("session_secret")}` },
            { name: "CMD_S3_BUCKET", value: bucket.bucket },
            { name: "CMD_S3_REGION", value: bucket.region },
            { name: "CMD_S3_ACCESS_KEY_ID", value: s3AccessKey.id },
            { name: "CMD_S3_SECRET_ACCESS_KEY", value: s3AccessKey.encryptedSecret },
        ];

        const dockerImage = "quay.io/hedgedoc/hedgedoc:1.8.2";

        const appService = new awsx.ecs.FargateService(`${name}-svc`, {
            cluster,
            taskDefinitionArgs: {
                container: {
                    image: dockerImage,
                    cpu: 256,
                    memory: 512,
                    portMappings: [ listener ],
                    environment: environment
                },
            },
            desiredCount: 1,
        });

        this.hostname = cdn.domainName;
    }
}

export const hostname = new HedgeDoc().hostname;
