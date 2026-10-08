import unittest
from fastapi import HTTPException
from app.preferences import validate,GLOBAL_KEYS

class MouseSeekPreferenceTests(unittest.TestCase):
    def test_valid_integer_seconds(self):
        self.assertIn('mouseSeekSeconds',GLOBAL_KEYS)
        for value in [1,5,7,30,120]:self.assertEqual(validate('mouseSeekSeconds',value),value)
    def test_invalid_values_are_rejected(self):
        for value in [True,False,0,-1,121,5.5,'5',None,{},float('nan')]:
            with self.subTest(value=value),self.assertRaises(HTTPException):validate('mouseSeekSeconds',value)
