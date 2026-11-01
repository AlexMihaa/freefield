"""No torch, GPU, models or network needed for startup policy tests."""
import unittest
from serve import configuration


class StartupPolicy(unittest.TestCase):
    def env(self, **extra):
        return {"FREEFIELD_TOKEN": "a" * 64, **extra}

    def test_cuda_by_default(self):
        self.assertEqual(configuration(self.env()), [])

    def test_cpu_explicit_for_ci(self):
        self.assertEqual(configuration(self.env(FREEFIELD_DEVICE="cpu")), ["--cpu"])

    def test_options_are_arguments_not_shell(self):
        self.assertEqual(configuration(self.env(FREEFIELD_COMFY_ARGS="--reserve-vram 1")), ["--reserve-vram", "1"])

    def test_missing_short_and_example_tokens_rejected(self):
        for token in ["", "short", "change-me" * 8, "<replace-with-random-secret>" * 2, "a " * 32, "я" * 64]:
            with self.subTest(token_length=len(token)), self.assertRaises(ValueError):
                configuration({"FREEFIELD_TOKEN": token})

    def test_open_gateway_forbidden(self):
        with self.assertRaises(ValueError):
            configuration(self.env(FREEFIELD_ALLOW_OPEN="1"))

    def test_device_override_rejected(self):
        with self.assertRaises(ValueError):
            configuration(self.env(FREEFIELD_DEVICE="amd"))

    def test_private_ports_and_directories_cannot_be_overridden(self):
        for value in ["--listen 0.0.0.0", "--listen=0.0.0.0", "--lis 0.0.0.0", "--por 9000", "--base-directory /tmp", "--models-directory /tmp", "--user-directory /tmp", "--reserve-vram -1", "--reserve-vram nan", "--reserve-vram inf", "--port 80", "--cpu", "--directml", "--input-directory /tmp", "--output-directory /tmp", "--extra-model-paths-config bad.yaml"]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                configuration(self.env(FREEFIELD_COMFY_ARGS=value))


if __name__ == "__main__":
    unittest.main()
