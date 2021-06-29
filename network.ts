import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

export class VpcArgs {
    constructor(
        public cidrBlock: string = '10.100.0.0/16',
        public instanceTenancy: string = 'default',
        public enableDnsHostnames: boolean = false,
        public enableDnsSupport: boolean = false
    ) {}
}

export class Vpc extends pulumi.ComponentResource {

    public vpc: aws.ec2.Vpc;
    public internetGateway: aws.ec2.InternetGateway;
    public routeTable: aws.ec2.RouteTable;
    public subnets: aws.ec2.Subnet[];
    public rdsSecurityGroup: aws.ec2.SecurityGroup;

    constructor(public name: string, private args: VpcArgs = new VpcArgs(), opts: pulumi.ResourceOptions = {}) {
        super('custom:resource:VPC', name, {}, opts);
    }

    public async setup() {
        this.vpc = new aws.ec2.Vpc(
            `${this.name}-vpc`,
            {
                cidrBlock: this.args.cidrBlock,
                instanceTenancy: this.args.instanceTenancy,
                enableDnsHostnames: this.args.enableDnsHostnames,
                enableDnsSupport: this.args.enableDnsSupport,
                tags: {
                    'Name': `${this.name}-vpc`
                },
            },
            { parent: this }
        );

        this.internetGateway = new aws.ec2.InternetGateway(
            `${this.name}-igw`,
            {
                vpcId: this.vpc.id,
                tags: {
                    'Name': `${this.name}-igw`
                }
            },
            { parent: this }
        );

        this.routeTable = new aws.ec2.RouteTable(
            `${this.name}-rt`,
            {
                vpcId: this.vpc.id,
                routes: [
                    {
                        cidrBlock: '0.0.0.0/0',
                        gatewayId: this.internetGateway.id
                    }
                ],
                tags: {
                    'Name': `${this.name}-rt`
                },
            },
            { parent: this }
        );

        const allZones = await aws.getAvailabilityZones({ state: "available" });
        const zoneNames = [ allZones.names[0], allZones.names[1] ];
        this.subnets = [];
        const subnetNameBase = `${name}-subnet`;
        for (let zone of zoneNames) {
            const vpcSubnet = new aws.ec2.Subnet(
                `${subnetNameBase}-${zone}`,
                {
                    assignIpv6AddressOnCreation: false,
                    vpcId: this.vpc.id,
                    mapPublicIpOnLaunch: false,
                    cidrBlock: `10.100.${this.subnets.length}.0/24`,
                    availabilityZone: zone,
                    tags: {
                        'Name': `${subnetNameBase}-${zone}`
                    }
                },
                { parent: this }
            );
            new aws.ec2.RouteTableAssociation(
                `vpc-route-table-assoc-${zone}`,
                {
                    routeTableId: this.routeTable.id,
                    subnetId: vpcSubnet.id,
                },
                { parent: this }
            );
            this.subnets.push(vpcSubnet);
        };

        this.rdsSecurityGroup = new aws.ec2.SecurityGroup(
            `${name}-rds-sg`,
            {
                vpcId: this.vpc.id,
                description: 'Allow client access.',
                tags: {
                    'Name': `${name}-rds-sg`
                },
                ingress: [
                    {
                        cidrBlocks: ['0.0.0.0/0'],
                        fromPort: 5432,
                        toPort: 5432,
                        protocol: 'tcp',
                        description: 'Allow rds access.'
                    }
                ],
                egress: [
                    {
                        protocol: '-1',
                        fromPort: 0,
                        toPort: 0,
                        cidrBlocks: ['0.0.0.0/0'],
                    }
                ]
            },
            { parent: this }
        );
        /*
        fe_sg_name = f'{name}-fe-sg'
        self.fe_security_group = ec2.SecurityGroup(fe_sg_name,
            vpc_id=self.vpc.id,
            description='Allow all HTTP(s) traffic.',
            tags={
                'Name': fe_sg_name
            },
            ingress=[
                ec2.SecurityGroupIngressArgs(
                    cidr_blocks=[
                        '0.0.0.0/0'],
                    from_port=443,
                    to_port=443,
                    protocol='tcp',
                    description='Allow https.'
                ),
                ec2.SecurityGroupIngressArgs(
                    cidr_blocks=[
                        '0.0.0.0/0'],
                    from_port=80,
                    to_port=80,
                    protocol='tcp',
                    description='Allow http access'
                ),
            ],
            egress=[
                ec2.SecurityGroupEgressArgs(
                    protocol='-1',
                    from_port=0,
                    to_port=0,
                    cidr_blocks=[
                        '0.0.0.0/0'],
                )],
            opts=ResourceOptions(
                parent=self)
            )
        */
    }

}
