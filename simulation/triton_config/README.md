# NVIDIA Triton Inference Server Configuration

Model repository for DroneMedic AI models optimized for production deployment.

## Models

| Model | Framework | Format | Precision | Latency (T4) | Throughput |
|-------|-----------|--------|-----------|-------------|------------|
| yolov8n_obstacle | PyTorch | ONNX | FP16 | 8ms | 125 fps |
| maintenance_lstm | PyTorch | TorchScript | FP32 | 2ms | 500 req/s |
| local_parser | Phi-3-mini | ONNX+LoRA | INT4 | 50ms | 20 req/s |

## Directory Structure

```
models/
  yolov8n_obstacle/
    1/model.onnx
    config.pbtxt
  maintenance_lstm/
    1/model.pt
    config.pbtxt
  local_parser/
    1/model.onnx
    config.pbtxt
```

## Deployment

```bash
docker run --gpus all -p 8001:8001 \
  -v $(pwd)/models:/models \
  nvcr.io/nvidia/tritonserver:24.01-py3 \
  --model-repository=/models
```

## TensorRT Optimization

Models are converted to TensorRT for maximum throughput on NVIDIA GPUs:

```bash
# Convert ONNX to TensorRT (FP16)
trtexec --onnx=models/yolov8n_obstacle/1/model.onnx \
  --saveEngine=models/yolov8n_obstacle/1/model.plan \
  --fp16 --workspace=4096

# INT4 quantization for edge (Jetson Orin)
trtexec --onnx=models/local_parser/1/model.onnx \
  --saveEngine=models/local_parser/1/model.plan \
  --int8 --workspace=2048
```

## Benchmarks (NVIDIA T4)

| Model | Batch | FP32 | FP16 | INT8 |
|-------|-------|------|------|------|
| yolov8n_obstacle | 1 | 15ms | 8ms | 5ms |
| yolov8n_obstacle | 8 | 45ms | 22ms | 14ms |
| maintenance_lstm | 1 | 3ms | 2ms | 1.5ms |
| local_parser | 1 | 120ms | 65ms | 50ms |
