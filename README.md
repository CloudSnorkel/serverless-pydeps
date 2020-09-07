# Serverless Python Dependencies

[![serverless](http://public.serverless.com/badges/v3.svg)](http://www.serverless.com)
![Github Actions](https://github.com/CloudSnorkel/serverless-pydeps/workflows/Build%20and%20Publish/badge.svg)
[![npm](https://img.shields.io/npm/v/serverless-pydeps.svg)](https://www.npmjs.com/package/serverless-pydeps)

[Serverless Framework](http://www.serverless.com/) plugin to automatically add Python dependencies as layers to your functions. 

Based on [Lovage](https://github.com/CloudSnorkel/lovage) - a Python-only serverless library that's more RPC-like and
less HTTP service oriented.

## Install

```shell
sls plugin install -n serverless-pydeps
```

This will automatically add the plugin to your project's `package.json` and the plugins section of its
`serverless.yml`. That's all you need. There is no need to install or configure anything else, not even Python.

The plugin will automatically create a layer from the dependencies listed in `Pipfile` or `requirements.txt` and attach
it to all functions with Python runtime when you run `sls deploy`.

## How Does It Work?

Dependencies are collected and packaged in a special Lambda function. This means you won't have to wait on dependencies
to download to your local computer, get zipped up, and uploaded back to S3. This makes deployment, and especially
updates, really fast. Dependencies will only be built and uploaded when they change. Your code packages will contain
your code and nothing else.

Dependencies will be installed by the same system that runs them, so you never have to worry about running the right
Python version on the right OS.

## Known Limitations

* Only AWS is supported since we use Lambda Layers
* [serverless-prune-plugin](https://github.com/claygregory/serverless-prune-plugin) will not clean-up old layers 

## Other Options

|   | serverless-pydeps | [serverless-python-requirements](https://github.com/UnitedIncome/serverless-python-requirements/) |
| ------------- | ------------- | ------------- |
| **Setup** | Install plugin | Install plugin, Python, and potentially Docker for consistent requirements |
| **Package speed** | Fast as dependencies are not packaged locally | Slow as every code change repackages all dependencies |
| **Upload Speed** | Never uploads anything locally | Uploads all dependencies on every code change |
| **Supported providers** | AWS | All providers supported by Serverless (AWS, GCP, Azure, etc.) |
| **Private repositories** | Not supported as dependencies are downloaded in a Lambda function | Supported |
| **Native code dependencies (`*.so` files)** | Only supported if dependency has proper binary wheel | Supported with custom `Dockerfile`, `dockerExtraFiles`, etc. |
| **Local disk usage** | Zero | All dependencies are cached and also stored in `.serverless` |
