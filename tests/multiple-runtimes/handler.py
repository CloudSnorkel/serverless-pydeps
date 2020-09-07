import requests
import platform


def test36(event, context):
    assert platform.python_version().startswith("3.6")


def test37(event, context):
    assert platform.python_version().startswith("3.7")
