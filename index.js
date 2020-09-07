'use strict';

const fs = require('fs');
const path = require('path');
const {spawnSync} = require('child_process');

class ServerlessPydeps {
    constructor(serverless, options) {
        this.serverless = serverless;
        this.options = options;

        // only AWS is supported right now as we use Lambda Layers
        this.provider = this.serverless.getProvider('aws');

        this.hooks = {
            'after:package:setupProviderConfiguration': this.addDependencies.bind(this),
        };

        // code for special Lambda that packages up dependencies and uploads to S3
        this.packagerCode = fs.readFileSync(path.resolve(__dirname, 'packager.py'), {encoding: 'utf-8'});
    }

    sanitizeRuntime(runtime) {
        return runtime[0].toUpperCase() + runtime.substr(1).toLowerCase().replace('.', '');
    }

    addDependencies() {
        const runtimes = new Set();

        // go over all functions and look for functions using Python runtime
        for (const functionName of this.serverless.service.getAllFunctions()) {
            const functionObject = this.serverless.service.getFunction(functionName);
            const runtime = this.sanitizeRuntime(this.provider.getRuntime(functionObject.runtime));

            if (runtime.startsWith('Python')) {
                // collect all different runtimes that are used
                runtimes.add(runtime);

                if (functionObject.layers && Array.isArray(functionObject.layers)) {
                    // already has layers, nothing to initialize
                } else if (this.serverless.service.provider.layers && Array.isArray(this.serverless.service.provider.layers)) {
                    // copy layers from provider so we don't override them
                    functionObject.layers = Array.from(this.serverless.service.provider.layers)
                } else {
                    // no layers at all, define empty array
                    functionObject.layers = [];
                }

                // add our layer to each function that uses Python
                functionObject.layers.push({'Ref': `${runtime}DependenciesLayer`});
            }
        }

        // if we found functions using Python runtime, add our dependencies packager
        if (runtimes.size > 0) {
            const requirements = this.loadRequirements();

            // add dependencies package generation for each runtime
            for (const runtime of runtimes) {
                this.addDependenciesForRuntime(runtime, requirements);
            }
        }
    }

    loadRequirements() {
        // try using Pipenv first
        if (fs.existsSync(path.join(this.serverless.config.servicePath, 'Pipfile'))) {
            this.serverless.cli.log('Loading dependencies from Pipenv...');
            const res = spawnSync('pipenv', ['lock', '--requirements'], {
                cwd: this.serverless.config.servicePath,
                encoding: 'utf-8',
            });
            if (res.error) {
                if (res.error.code === 'ENOENT') {
                    throw new Error(`pipenv not found! Install it with 'pip install pipenv'.`);
                }
                throw new Error(res.error);
            }
            if (res.status !== 0) {
                throw new Error(res.stderr);
            }
            return res.stdout;
        }

        // next get dependencies from requirements.txt file
        const requirementsTxtPath = path.join(this.serverless.config.servicePath, 'requirements.txt');
        if (fs.existsSync(requirementsTxtPath)) {
            return fs.readFileSync(requirementsTxtPath, {encoding: 'utf-8'});
        }

        // otherwise fail so the user doesn't get stuck without dependencies
        throw new Error('No dependencies found (no requirements.txt and no Pipfile)');
    }

    /**
     * This is where the magic happens. Here we add all the required resources to CloudFormation to create the layer
     * containing all the Python dependencies.
     *
     * We add a Lambda function based on packager.py that gets a list of requirements as input, collects all the
     * dependencies, packages them, uploads them to S3 (based on bucket and key prefix input), and finally returns the
     * key for other resources to use.
     *
     * We then add a custom resource using this function and passing in the requirements as a parameter.
     *
     * Finally we add a Lambda Layer that uses the output of the custom resource as a path to S3 where the package
     * containing all the dependencies is located. This layer has a well-known name that gets added to every function in
     * `addDependencies()`.
     *
     * This function is called once for every version of Python runtime. Different versions of Python might pull
     * different dependencies or different version of dependencies. We can't use the same packaged dependencies for all
     * versions of Python. That's why `runtime` is passed in and is used everywhere.
     */
    addDependenciesForRuntime(runtime, requirements) {
        this.serverless.cli.log(`Adding ${runtime} dependencies resource...`);

        const keyBase = `serverless/${this.serverless.service.service}/${this.serverless.providers.aws.getStage()}/pydeps`;
        const commonNamePrefix = `${this.serverless.service.service}-${this.serverless.providers.aws.getStage()}`;
        const packagerFunctionName = `${commonNamePrefix}-pydeps-${runtime}-packager`;
        const layerName = `${commonNamePrefix}-pydeps-${runtime}`;

        this.serverless.service.provider.compiledCloudFormationTemplate.Resources[`${runtime}DependenciesLayer`] = {
            Type: 'AWS::Lambda::LayerVersion',
            Properties: {
                Content: {
                    S3Bucket: {
                        Ref: 'ServerlessDeploymentBucket',
                    },
                    S3Key: {
                        'Fn::GetAtt': [`${runtime}DependenciesPackage`, 'Key'],
                    },
                },
                LayerName: layerName,
                Description: 'Python dependencies generated by serverless-pydeps.',
            },
        };

        this.serverless.service.provider.compiledCloudFormationTemplate.Resources[`${runtime}DependenciesPackagerLogGroup`] = {
            Type: 'AWS::Logs::LogGroup',
            Properties: {
                LogGroupName: `/aws/lambda/${packagerFunctionName}`,
            }
        }

        this.serverless.service.provider.compiledCloudFormationTemplate.Resources[`${runtime}DependenciesPackager`] = {
            Type: 'AWS::Lambda::Function',
            DependsOn: [`${runtime}DependenciesPackagerLogGroup`],
            Properties: {
                Code: {
                    ZipFile: this.packagerCode
                },
                Handler: 'index.handler',
                MemorySize: 1024,
                Role: {
                    'Fn::GetAtt': [
                        `${runtime}DependenciesPackagerRole`,
                        'Arn'
                    ]
                },
                Runtime: this.serverless.service.provider.runtime,
                Timeout: 15 * 60,
                FunctionName: packagerFunctionName,
            }
        };

        this.serverless.service.provider.compiledCloudFormationTemplate.Resources[`${runtime}DependenciesPackagerRole`] = {
            Type: 'AWS::IAM::Role',
            Properties: {
                AssumeRolePolicyDocument: {
                    Version: '2012-10-17',
                    Statement: [
                        {
                            Effect: 'Allow',
                            Principal: {
                                Service: [
                                    'lambda.amazonaws.com'
                                ]
                            },
                            Action: [
                                'sts:AssumeRole'
                            ]
                        }
                    ]
                },
                Policies: [
                    {
                        PolicyName: `${commonNamePrefix}-lambda`,
                        PolicyDocument: {
                            Version: '2012-10-17',
                            Statement: [
                                {
                                    Effect: 'Allow',
                                    Action: [
                                        'logs:CreateLogStream',
                                        // don't let it create the group after it has been deleted by cfm -- 'logs:CreateLogGroup',
                                        'logs:PutLogEvents'
                                    ],
                                    Resource: [
                                        {
                                            'Fn::GetAtt': [`${runtime}DependenciesPackagerLogGroup`, 'Arn'],
                                        }
                                    ]
                                },
                                {
                                    Effect: 'Allow',
                                    Action: [
                                        's3:PutObject',
                                        's3:DeleteObject'
                                    ],
                                    Resource: {
                                        'Fn::Sub': `\${ServerlessDeploymentBucket.Arn}/${keyBase}/*`
                                    }
                                }
                            ]
                        }
                    }
                ],
                Path: '/',
                RoleName: {
                    'Fn::Sub': `${commonNamePrefix}-\${AWS::Region}-${runtime}PackagerLambdaRole`,
                }
            }
        };

        this.serverless.service.provider.compiledCloudFormationTemplate.Resources[`${runtime}DependenciesPackage`] = {
            Type: 'Custom::PythonDependencies',
            DependsOn: [`${runtime}DependenciesPackagerLogGroup`, `${runtime}DependenciesPackager`],
            Properties: {
                ServiceToken: {
                    'Fn::GetAtt': [`${runtime}DependenciesPackager`, 'Arn']
                },
                Bucket: {
                    Ref: 'ServerlessDeploymentBucket',
                },
                Prefix: keyBase,
                Requirements: requirements,
            }
        }
    }
}

module.exports = ServerlessPydeps;
