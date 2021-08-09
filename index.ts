import * as pulumi from "@pulumi/pulumi";
import * as awsx from "@pulumi/awsx";
import * as aws from "@pulumi/aws";
import * as tls from "@pulumi/tls";

export class HedgeDoc extends pulumi.ComponentResource {

    public hostname: pulumi.Output<string> | undefined;

    constructor(public readonly name: string = "hedgedoc1", opts: pulumi.ResourceOptions = {}) {
        super('custom:resource:HedgeDoc', name, {}, opts);

        const cfg = new pulumi.Config();

        const vpcx = new awsx.ec2.Vpc(`${this.name}-vpc`, {
            cidrBlock: "10.0.0.0/24",
            numberOfAvailabilityZones: 2,
            numberOfNatGateways: 1
        }, { parent: this });

        const dbSubnets = new aws.rds.SubnetGroup(`${this.name}-dbsubnets`, {
            subnetIds: vpcx.privateSubnetIds
        }, { parent: this });

        const dbSecurityGroup = new awsx.ec2.SecurityGroup(`${this.name}-db-security-group`, { vpc: vpcx }, { parent: this });
        awsx.ec2.SecurityGroupRule.ingress(
            `${this.name}-db-ingress`,
            dbSecurityGroup,
            new awsx.ec2.AnyIPv4Location(),
            new awsx.ec2.TcpPorts(5432),
            "allow postgres access"
        );

        const dbInstanceArgs: aws.rds.InstanceArgs = {
            name: this.name,
            username: this.name,
            password: cfg.getSecret("db_password"),
            allocatedStorage: 20,
            dbSubnetGroupName: dbSubnets.id,
            vpcSecurityGroupIds: [ dbSecurityGroup.id ],
            engine: "postgres",
            engineVersion: "12",
            instanceClass: "db.t2.micro",
            storageType: "standard",
            skipFinalSnapshot: true,
            publiclyAccessible: false,
            applyImmediately: true
        };
        const db = new aws.rds.Instance(`${this.name}-db`, dbInstanceArgs, { parent: this });

        const clusterArgs: awsx.ecs.ClusterArgs = {
            vpc: vpcx
        };
        const cluster = new awsx.ecs.Cluster(`${this.name}-cluster`, clusterArgs, { parent: this })

        const appLoadBalancer = new awsx.lb.ApplicationLoadBalancer(`${this.name}-lb`, {
            vpc: vpcx,
            external: true,
            securityGroups: cluster.securityGroups
        }, { parent: this });

        this.hostname = appLoadBalancer.loadBalancer.dnsName;

        const targetGroup = appLoadBalancer.createTargetGroup(`${this.name}-tg`, {
            port: 3000,
            protocol: "HTTP",
            loadBalancer: appLoadBalancer,
            deregistrationDelay: 10
        }, { parent: this });

        const privateKey = new tls.PrivateKey(`${this.name}-private-key`, {
            algorithm: "RSA"
        }, { parent: this });
        const selfSignedCert = new tls.SelfSignedCert(`${this.name}-selfsigned-cert`, {
            keyAlgorithm: "RSA",
            privateKeyPem: privateKey.privateKeyPem,
            subjects: [{
                commonName: this.hostname,
                organization: "ACME Examples, Inc",
            }],
            validityPeriodHours: 720,
            allowedUses: [
                "key_encipherment",
                "digital_signature",
                "server_auth",
            ],
        }, { parent: this });
        const certificate = new aws.acm.Certificate(`${this.name}-certificate`, {
            privateKey: privateKey.privateKeyPem,
            certificateBody: selfSignedCert.certPem,
        }, { parent: this });

        const listener = appLoadBalancer.createListener(`${this.name}-lst`, {
            port: 443,
            protocol: "HTTPS",
            sslPolicy: "ELBSecurityPolicy-2016-08",
            certificateArn: certificate.arn
        }, { parent: this });
        listener.addListenerRule(`${this.name}-lb-tg-listener-rule`, {
            actions: [{ type: "forward", targetGroupArn: targetGroup.targetGroup.arn }],
            conditions: [{ pathPattern: { values: ["/*"] } }]
        }, { parent: this });

        appLoadBalancer.createListener(`${this.name}-redirect-lst`, {
            port: 80,
            protocol: "HTTP",
            defaultAction: {
                type: "redirect",
                redirect: {
                    protocol: "HTTPS",
                    port: "443",
                    statusCode: "HTTP_301"
                }
            }
        }, { parent: this });

        const s3User = new aws.iam.User(`${this.name}-s3-user`, {
            path: "/system/"
        }, { parent: this });
        const bucket = new aws.s3.Bucket(`${this.name}-bucket`, {
            forceDestroy: true
        }, { parent: this });
        new aws.iam.UserPolicy(`${this.name}-s3-user-policy`, {
            user: s3User.name,
            policy: pulumi.all([bucket.arn]).apply(([bucketArn]) => JSON.stringify({
                "Id": "UserPolicyUploads",
                "Version": "2012-10-17",
                "Statement": [{
                    "Sid": "StmtAllowUploads",
                    "Effect": "Allow",
                    "Action": "s3:*",
                    "Resource": `${bucketArn}/*`
                }]
            }))
        }, { parent: this })

        const s3AccessKey = new aws.iam.AccessKey(`${this.name}-s3-access-key`, {
            user: s3User.name,
        }, { parent: this });

        new aws.s3.BucketPolicy(`${this.name}-bucket-policy`, {
            bucket: bucket.id,
            policy: pulumi.all([bucket.arn, s3User.arn]).apply(([bucketArn, userArn]) => JSON.stringify({
                "Id": "PolicyUploads",
                "Version": "2012-10-17",
                "Statement": [{
                    "Sid": "StmtAllowUploadsGet",
                    "Effect": "Allow",
                    "Principal": "*",
                    "Action": "s3:GetObject",
                    "Resource": `${bucketArn}/*`
                }, {
                    "Sid": "StmtAllowUploadsAll",
                    "Effect": "Allow",
                    "Principal": {
                        "AWS": [
                            `${userArn}`
                        ]
                    },
                    "Action": "s3:*",
                    "Resource": `${bucketArn}/*`
                }]
            })),
        }, { parent: this });

        const dockerImage = "quay.io/hedgedoc/hedgedoc:1.8.2";

        const environmentArgs = pulumi.all([
            cfg.getSecret("db_password"),
            db.address,
            db.port,
            cfg.getSecret("session_secret"),
            this.hostname,
            s3AccessKey.secret,
            bucket.region
        ]);
        environmentArgs.apply(([dbPassword, dbAddress, dbPort, sessionSecret, hostname, s3SecretAccessKey, s3Region]) => new awsx.ecs.FargateService(
            `${this.name}-svc`,
            {
                cluster,
                assignPublicIp: false,
                taskDefinitionArgs: {
                    container: {
                        image: dockerImage,
                        cpu: 256,
                        memory: 512,
                        portMappings: [ targetGroup ],
                        environment: [
                            {
                                name: "CMD_DB_URL",
                                value: `postgres://${this.name}:${dbPassword}@${dbAddress}:${dbPort}/${this.name}`
                            },
                            { name: "CMD_IMAGE_UPLOAD_TYPE", value: "s3" },
                            { name: "CMD_DOMAIN", value: `${hostname}` },
                            { name: "CMD_PROTOCOL_USESSL", value: "true" },
                            { name: "CMD_ALLOW_ORIGIN", value: `['${hostname}']` },
                            { name: "CMD_SESSION_SECRET", value: `${sessionSecret}` },
                            { name: "CMD_S3_BUCKET", value: bucket.bucket },
                            { name: "CMD_S3_REGION", value: bucket.region },
                            { name: "CMD_S3_ACCESS_KEY_ID", value: s3AccessKey.id },
                            { name: "CMD_S3_SECRET_ACCESS_KEY", value: `${s3SecretAccessKey}` },
                            { name: "CMD_S3_ENDPOINT", value: `s3.${s3Region}.amazonaws.com` },
                        ]
                    },
                },
                desiredCount: 1,
            }
        ));
    }
}

let hedgeDoc: HedgeDoc = new HedgeDoc();

export const hostname = hedgeDoc.hostname;
