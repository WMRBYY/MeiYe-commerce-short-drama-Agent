import importlib.util
import pathlib
import subprocess
import sys
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).with_name("sam2_mask.py")
spec = importlib.util.spec_from_file_location("sam2_mask", SCRIPT)
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class WorkerContractTests(unittest.TestCase):
    def test_requires_finite_contained_subject_box(self):
        for box in ["[]", "[0,0,0,1]", "[0.8,0,0.5,1]", "[NaN,0,1,1]"]:
            with self.assertRaises(ValueError):
                worker.parse_box(box)
        self.assertEqual(worker.parse_box("[0.1,0.2,0.5,0.7]"), [0.1,0.2,0.5,0.7])

    def test_missing_model_fails_before_loading_runtime(self):
        result = subprocess.run([sys.executable, str(SCRIPT), "--check", "--checkpoint",
                                 str(SCRIPT.with_name("missing-checkpoint.pt"))],
                                capture_output=True, text=True, timeout=10)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("checkpoint is missing", result.stderr)
        self.assertNotIn('"ready": true', result.stdout)

    def test_gpu_slot_is_exclusive_and_released(self):
        with tempfile.TemporaryDirectory() as directory:
            path = str(pathlib.Path(directory) / "gpu.lock")
            with worker.device_lock(path):
                with self.assertRaises(TimeoutError):
                    with worker.device_lock(path, timeout=0):
                        self.fail("another inference entered an occupied GPU")
            with worker.device_lock(path, timeout=0):
                pass


if __name__ == "__main__":
    unittest.main()
