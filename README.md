# Deploy HedgeDoc Using AWS

This deploys HedgeDoc running on Fargate.

## Deploying the App

To deploy your infrastructure, follow the below steps.

### Prerequisites

1. [Install Pulumi](https://www.pulumi.com/docs/get-started/install/)
2. [Configure AWS Credentials](https://www.pulumi.com/docs/intro/cloud-providers/aws/setup/)

### Steps

After cloning this repo, from this working directory, run these commands:

1. Create a new stack, which is an isolated deployment target for this example:

    ```bash
    $ pulumi stack init
    ```

2. Set the required configuration variables for this program:

    ```bash
    $ pulumi config set aws:profile default
    $ pulumi config set aws:region eu-west-1
    $ pulumi config set db_password someDatabasePassword
    $ pulumi config set session_secret someSessionSecret
    ```

3. Set up Fargate service, which will also serve on CloudFront:

    ```bash
    $ pulumi up
    ```

4. After a couple minutes, your service will be ready, and stack output is printed:

    ```bash
    $ pulumi stack output
    Current stack outputs (1):
    OUTPUT          VALUE
    hostname        ...
    ```

5. Thanks to the CloudFront making the service accessible from the internet, we can curl it:

    ```bash
    $ curl $(pulumi stack output hostname)
    ...
    ```

## Destroying the App

To destroy your stack and remove it:

```bash
$ pulumi destroy --yes
$ pulumi stack rm --yes
```
