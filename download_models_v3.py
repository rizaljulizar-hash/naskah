"""
Download onnx-community Whisper models (v3-compatible) to ./models/ folder.
These work with @huggingface/transformers v3 + dtype:'q8'.
"""
import urllib.request
import os
import json
import sys

BASE = "https://huggingface.co"

MODELS = {
    "onnx-community/whisper-tiny": {
        "config_files": [
            "config.json",
            "generation_config.json",
            "preprocessor_config.json",
            "tokenizer.json",
            "tokenizer_config.json",
        ],
        "onnx_files": [
            "onnx/encoder_model_quantized.onnx",
            "onnx/decoder_model_merged_quantized.onnx",
        ],
    },
    "onnx-community/whisper-base": {
        "config_files": [
            "config.json",
            "generation_config.json",
            "preprocessor_config.json",
            "tokenizer.json",
            "tokenizer_config.json",
        ],
        "onnx_files": [
            "onnx/encoder_model_quantized.onnx",
            "onnx/decoder_model_merged_quantized.onnx",
        ],
    },
    "onnx-community/whisper-small": {
        "config_files": [
            "config.json",
            "generation_config.json",
            "preprocessor_config.json",
            "tokenizer.json",
            "tokenizer_config.json",
        ],
        "onnx_files": [
            "onnx/encoder_model_quantized.onnx",
            "onnx/decoder_model_merged_quantized.onnx",
        ],
    },
}


def download_file(url, dest):
    """Download a file with progress indicator."""
    if os.path.exists(dest) and os.path.getsize(dest) > 1000:
        print(f"  SKIP (already exists): {dest} ({os.path.getsize(dest)/1024/1024:.1f} MB)")
        return True

    os.makedirs(os.path.dirname(dest), exist_ok=True)
    print(f"  Downloading: {url}")
    try:
        urllib.request.urlretrieve(url, dest)
        size_mb = os.path.getsize(dest) / 1024 / 1024
        print(f"  SAVED: {dest} ({size_mb:.1f} MB)")
        return True
    except Exception as e:
        print(f"  ERROR: {e}")
        if os.path.exists(dest):
            os.remove(dest)
        return False


def main():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    models_dir = os.path.join(base_dir, "models")

    for model_id, files in MODELS.items():
        print(f"\n{'='*60}")
        print(f"Downloading: {model_id}")
        print(f"{'='*60}")

        model_dir = os.path.join(models_dir, model_id.replace("/", os.sep))
        os.makedirs(model_dir, exist_ok=True)

        all_files = files["config_files"] + files["onnx_files"]
        success = True

        for fname in all_files:
            url = f"{BASE}/{model_id}/resolve/main/{fname}"
            dest = os.path.join(model_dir, fname.replace("/", os.sep))
            if not download_file(url, dest):
                success = False

        if success:
            print(f"[OK] {model_id} -- ALL FILES DOWNLOADED SUCCESSFULLY!")
        else:
            print(f"[FAIL] {model_id} -- SOME FILES FAILED!")

    print(f"\n{'='*60}")
    print("ALL MODELS DOWNLOAD COMPLETE!")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
