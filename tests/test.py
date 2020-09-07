import json
from argparse import ArgumentParser
from os import chdir
from pathlib import Path
from subprocess import run

import yaml

parser = ArgumentParser()
parser.add_argument("--deploy", action="store_true")
parser.add_argument("--keep", action="store_true")
parser.add_argument("tests", metavar="TEST", nargs="*")
args = parser.parse_args()

run("npm pack ..", shell=True, check=True)
version = json.load(open("../package.json"))["version"]
original_cwd = Path.cwd()

for test_dir in Path(__file__).parent.iterdir():
    chdir(original_cwd)

    if not test_dir.is_dir():
        continue

    if args.tests and test_dir.name not in args.tests:
        continue

    chdir(test_dir.absolute())

    print(" *** TESTING", test_dir.name)

    run(f"npm install --no-save ../serverless-pydeps-{version}.tgz", shell=True, check=True)

    if args.deploy:
        try:
            run("sls deploy", shell=True, check=True)
            for function in yaml.load(open("serverless.yml"), Loader=yaml.BaseLoader)["functions"]:
                run(f"sls invoke --function {function} --log", shell=True, check=True)
        finally:
            if not args.keep:
                run("sls remove", shell=True)

    else:
        run("sls package", shell=True, check=True)
