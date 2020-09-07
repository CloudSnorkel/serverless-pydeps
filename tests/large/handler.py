import numpy as np
from scipy.stats import norm
from sklearn import datasets

def test(event, context):
    a = np.arange(15).reshape(3, 5)
    print(norm.cdf(a))
    print(datasets.load_digits())
