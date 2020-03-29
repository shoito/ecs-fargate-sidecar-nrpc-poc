import * as cdk from "@aws-cdk/core";
import * as ec2 from "@aws-cdk/aws-ec2";
import * as ecs from "@aws-cdk/aws-ecs";
import * as elb from "@aws-cdk/aws-elasticloadbalancingv2";
import * as cloudmap from "@aws-cdk/aws-servicediscovery";

export interface ExtendedStackProps extends cdk.StackProps {
  cluster: ecs.Cluster;
  listener: elb.ApplicationListener;
}

export class EcsXyzBffServiceStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props: ExtendedStackProps) {
    super(scope, id, props);

    const NRPC_PORT = 80;
    const BFF_PORT = 3000;

    const logDriver = new ecs.AwsLogDriver({
      streamPrefix: "poc"
    });

    const taskDef = new ecs.FargateTaskDefinition(
      this,
      "poc-xyz-bff-task-def",
      {
        family: "poc-xyz-bff-task"
      }
    );

    const bffContainer = taskDef.addContainer("poc-xyz-bff-container", {
      image: ecs.ContainerImage.fromAsset("./containers/xyz-bff"),
      memoryLimitMiB: 512,
      cpu: 256,
      logging: logDriver,
      environment: {
        NODE_ENV: "production"
      }
    });

    bffContainer.addPortMappings({
      containerPort: BFF_PORT,
      hostPort: BFF_PORT,
      protocol: ecs.Protocol.TCP
    });

    const nrpcContainer = taskDef.addContainer("poc-xyz-nrpc-container", {
      image: ecs.ContainerImage.fromAsset("./containers/xyz-nrpc"),
      memoryLimitMiB: 512,
      cpu: 256,
      logging: logDriver
    });

    nrpcContainer.addPortMappings({
      containerPort: NRPC_PORT,
      hostPort: NRPC_PORT,
      protocol: ecs.Protocol.TCP
    });

    nrpcContainer.addLink(bffContainer, "bff");

    const sg = new ec2.SecurityGroup(this, "poc-xyz-bff-service-sg", {
      securityGroupName: "poc-xyz-bff-service-sg",
      vpc: props.cluster.vpc,
      allowAllOutbound: true
    });
    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(NRPC_PORT));

    const service = new ecs.FargateService(this, "poc-xyz-bff-service", {
      serviceName: "poc-xyz-bff-service",
      cluster: props.cluster,
      assignPublicIp: false,
      taskDefinition: taskDef,
      desiredCount: 3,
      securityGroup: sg,
      healthCheckGracePeriod: cdk.Duration.minutes(1),
      deploymentController: { type: ecs.DeploymentControllerType.ECS }
    });

    service.enableCloudMap({
      name: "poc-xyz-bff-service",
      dnsRecordType: cloudmap.DnsRecordType.A,
      dnsTtl: cdk.Duration.seconds(60)
    });

    props.listener.addTargets("poc-xyz-nrpc-tg", {
      targetGroupName: "poc-xyz-nrpc-tg",
      protocol: elb.ApplicationProtocol.HTTP,
      port: NRPC_PORT,
      healthCheck: {
        path: "/health",
        interval: cdk.Duration.seconds(15),
        timeout: cdk.Duration.seconds(10)
      },
      targets: [service]
    });
  }
}
