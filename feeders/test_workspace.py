import os
import tempfile
import unittest
from pathlib import Path

from workspace import resolve_feeder_output


class WorkspaceBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.engine = root / "engine"
        self.project = root / "product"
        self.engine.mkdir()
        self.project.mkdir()
        (self.engine / ".git").mkdir()
        (self.project / ".git").mkdir()
        self.scene = self.engine / "scenes" / "product_beauty.py"

    def tearDown(self):
        self.temp.cleanup()

    def resolve(self, **overrides):
        options = {
            "engine_root": self.engine,
            "feeder": "blender",
            "scene": self.scene,
            "out": None,
            "project": str(self.project),
            "brand": "example-brand",
            "diagnostic_temp": False,
        }
        options.update(overrides)
        return resolve_feeder_output(**options)

    def test_external_production_default_uses_brand_and_scene(self):
        output, project = self.resolve()
        self.assertEqual(project, self.project.resolve())
        self.assertEqual(
            output,
            self.project
            / "marketing"
            / "assets"
            / "example-brand"
            / "assets"
            / "product-beauty",
        )

    def test_engine_project_and_output_escape_are_rejected(self):
        with self.subTest("engine cannot be the product"):
            with self.assertRaisesRegex(ValueError, "outside the animation engine"):
                self.resolve(project=str(self.engine))
        with self.subTest("output cannot escape the product"):
            with self.assertRaisesRegex(
                ValueError, "output must stay inside product repository"
            ):
                self.resolve(out=str(self.project.parent / "escaped"))

    def test_production_requires_a_safe_brand(self):
        with self.assertRaisesRegex(ValueError, "safe-slug"):
            self.resolve(brand="../escaped")

    def test_diagnostic_output_cannot_escape_os_temp(self):
        outside_temp = (
            Path(tempfile.gettempdir()).resolve().parent / "escaped-diagnostic"
        )
        with self.assertRaisesRegex(ValueError, "OS temp directory"):
            self.resolve(
                project=None, brand=None, diagnostic_temp=True, out=str(outside_temp)
            )

    def test_existing_link_cannot_escape_product(self):
        outside = self.project.parent / "outside"
        outside.mkdir()
        link = self.project / "linked-output"
        try:
            os.symlink(outside, link, target_is_directory=True)
        except OSError as error:
            self.skipTest(f"directory links are not supported: {error}")
        with self.assertRaisesRegex(
            ValueError, "output must stay inside product repository"
        ):
            self.resolve(out="linked-output/render")


if __name__ == "__main__":
    unittest.main()
