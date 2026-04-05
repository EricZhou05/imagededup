# Image Deduplicator (imagededup)

[![Build Status](https://github.com/idealo/imagededup/actions/workflows/test.yml/badge.svg?branch=master)](https://github.com/idealo/imagededup/actions/workflows/test.yml)
[![Docs](https://img.shields.io/badge/docs-online-brightgreen)](https://idealo.github.io/imagededup/)
[![codecov](https://codecov.io/gh/idealo/imagededup/branch/master/graph/badge.svg)](https://codecov.io/gh/idealo/imagededup)
[![PyPI Version](https://img.shields.io/pypi/v/imagededup)](https://pypi.org/project/imagededup/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://github.com/idealo/imagededup/blob/master/LICENSE)

imagededup is a python package that simplifies the task of finding **exact** and **near duplicates** in an image collection.

<p align="center">
  <img src="readme_figures/mona_lisa.png" width="600" />
</p>

This package provides functionality to make use of hashing algorithms that are particularly good at finding exact
duplicates as well as convolutional neural networks which are also adept at finding near duplicates. An evaluation
framework is also provided to judge the quality of deduplication for a given dataset.

Following details the functionality provided by the package:

- Finding duplicates in a directory using one of the following algorithms:
  - [Convolutional Neural Network](https://arxiv.org/abs/1905.02244#:~:text=MobileNetV3%20is%20tuned%20to%20mobile,improved%20through%20novel%20architecture%20advances.) (CNN) - Select from several prepackaged models or provide your own custom model.
  - [Perceptual hashing](http://www.hackerfactor.com/blog/index.php?/archives/432-Looks-Like-It.html) (PHash)
  - [Difference hashing](http://www.hackerfactor.com/blog/index.php?/archives/529-Kind-of-Like-That.html) (DHash)
  - [Wavelet hashing](https://fullstackml.com/wavelet-image-hash-in-python-3504fdd282b5) (WHash)
  - [Average hashing](http://www.hackerfactor.com/blog/index.php?/archives/432-Looks-Like-It.html) (AHash)
- Generation of encodings for images using one of the above stated algorithms.
- Framework to evaluate effectiveness of deduplication  given a ground truth mapping.
- Plotting duplicates found for a given image file.

Detailed documentation for the package can be found at: [https://idealo.github.io/imagededup/](https://idealo.github.io/imagededup/)

imagededup is compatible with Python 3.9+ and runs on Linux, MacOS X and Windows.
It is distributed under the Apache 2.0 license.

## 📖 Contents

- [Installation](#%EF%B8%8F-installation)
- [Web UI (Recommended)](#%EF%B8%8F-web-ui-recommended)
- [Quick Start](#-quick-start)
- [Benchmarks](#-benchmarks)
- [Contribute](#-contribute)
- [Citation](#-citation)
- [Maintainers](#-maintainers)
- [License](#-copyright)

## ⚙️ Installation

There are two ways to install imagededup:

- Install imagededup from PyPI (recommended):

```
pip install imagededup
```

- Install imagededup from the GitHub source:

```bash
git clone https://github.com/idealo/imagededup.git
cd imagededup
pip install .
```  

## 🖥️ Web UI (Recommended)

项目提供了一个功能强大的本地 Web 界面，支持多目录扫描、实时进度展示、以及专为差分图片比对优化的“闪烁比对”模式。

### 1. 环境准备 (初次使用)

首先，确保你的系统已安装 Python 3.9+ 和 Node.js (推荐使用 [pnpm](https://pnpm.io/))。

#### 创建虚拟环境并安装后端依赖
```powershell
# 创建虚拟环境
python -m venv .venv

# 激活虚拟环境 (Windows)
.\.venv\Scripts\activate

# 安装项目及后端依赖
pip install -r requirements.txt
pip install -e .
```

#### 安装前端依赖
```powershell
cd webui/frontend
pnpm install
cd ../..
```

### 2. 快速启动

在项目根目录下，直接运行一键启动脚本：
```powershell
.\.venv\Scripts\python.exe run_webui.py
```
该脚本会自动同时启动后端 API 和前端界面，并自动在浏览器中打开 UI。

### 3. 开发与调试 (独立启动)

如果你需要进行开发调试，可以分别启动前后端：

- **启动后端服务**:
  ```powershell
  .\.venv\Scripts\python.exe -m uvicorn webui.backend.main:app --host 127.0.0.1 --port 8000
  ```

- **启动前端开发服务器**:
  ```powershell
  cd webui/frontend
  pnpm dev
  ```

### 4. 前端构建

如果你希望构建前端静态资源：
```powershell
cd webui/frontend
pnpm build
```
构建后的文件将生成在 `webui/frontend/dist` 目录下。

---

### 📊 Web UI 现状分析报告

经过对 `webui` 目录下的后端（FastAPI）和前端（React/TS）代码的深度集成，当前的系统状态如下：

#### 1. 核心架构与启动方式
- **双端分离**：采用 **FastAPI** 后端与 **Vite/React** 前端。
- **一键启动**：根目录下的 `run_webui.py` 会自动开启后端服务（端口 8000）和前端界面（端口 5173），并自动在浏览器中打开 UI。

#### 2. 已实现的关键功能
- **全算法支持**：后端 `scanner.py` 已集成 `imagededup` 的 **CNN** 以及 **PHash/DHash/AHash/WHash** 全部五种算法。
- **实时进度推送**：通过 **WebSocket (`/ws/status`)** 实现了扫描进度的实时回传，前端可同步展示当前处理的文件名及进度条。
- **沉浸式“闪烁比对”系统**：
    - **对比逻辑**：前端 `App.tsx` 采用切换组内图片的“闪烁”方式，配合 **同步缩放与平移 (Sync-Zoom/Pan)**，能够更精准地发现差分图（如二次元画师的微调图）的微小差异。
    - **快捷键优化**：完整支持 `←/→` 切换图片、`↑/↓` 切换重复组、`Space/Enter` 快速勾选。
- **智能预警与自动勾选**：
    - **路径高亮**：UI 会自动加粗显示组内文件路径的不同之处，帮助快速识别文件来源。
    - **属性预警**：自动检测并标红较小的分辨率或文件体积，辅助决策清理劣质图。
    - **智能勾选**：系统默认自动勾选每组中 **文件体积最小** 的图片作为待处理项，最大化释放空间。
- **文件处理逻辑**：支持一键将勾选项移动到备份文件夹，具备 **自动更名防覆盖** 机制。

#### 3. 与旧方案的差异（现状优化点）
- **比对逻辑演进**：由传统的“滑动对比”进化为更高效的“闪烁+Canvas 缩放”对比，解决了查看超大图细节不便的问题。
- **移动策略**：目前的移动逻辑倾向于“安全备份”，所有文件移动到同一备份目录下并自动处理同名冲突。

#### 4. 后续可完善方向
- **路径结构保持**：扩展 `move_file` 函数以支持在备份文件夹中保持原始的层级结构。
- **多选功能**：增加批量操作（如全选当前页、反选等）。

> **总结**：该 Web UI 已经是一个高度可用的专业级工具，特别在二次元插画和高质量摄影图片的细节比对、多目录去重场景下，其交互体验显著优于市面上大多数开源去重工具。

## 🚀 Quick Start

In order to find duplicates in an image directory using perceptual hashing, following workflow can be used:

- Import perceptual hashing method

```python
from imagededup.methods import PHash
phasher = PHash()
```

- Generate encodings for all images in an image directory

```python
encodings = phasher.encode_images(image_dir='path/to/image/directory')
```

- Find duplicates using the generated encodings

```python
duplicates = phasher.find_duplicates(encoding_map=encodings)
```

- Plot duplicates obtained for a given file (eg: 'ukbench00120.jpg') using the duplicates dictionary

```python
from imagededup.utils import plot_duplicates
plot_duplicates(image_dir='path/to/image/directory',
                duplicate_map=duplicates,
                filename='ukbench00120.jpg')
```

The output looks as below:

<p align="center">
  <img src="readme_figures/plot_dups.png" width="600" />
</p>

The complete code for the workflow is:

```python
from imagededup.methods import PHash
phasher = PHash()

# Generate encodings for all images in an image directory
encodings = phasher.encode_images(image_dir='path/to/image/directory')

# Find duplicates using the generated encodings
duplicates = phasher.find_duplicates(encoding_map=encodings)

# plot duplicates obtained for a given file using the duplicates dictionary
from imagededup.utils import plot_duplicates
plot_duplicates(image_dir='path/to/image/directory',
                duplicate_map=duplicates,
                filename='ukbench00120.jpg')
```
To run the above snippet on Windows, have a look [here](https://idealo.github.io/imagededup/user_guide/windows/).
It is also possible to use your own custom models for finding duplicates using the CNN method.

For examples, refer [this](https://github.com/idealo/imagededup/tree/master/examples) part of the
repository.

For more detailed usage of the package functionality, refer: [https://idealo.github.io/imagededup/](https://idealo.github.io/imagededup/)

## ⏳ Benchmarks

**Update**: Provided benchmarks are only valid upto `imagededup v0.2.2`. The next releases have significant changes to all methods, so the current benchmarks may not hold.

Detailed benchmarks on speed and classification metrics for different methods have been provided in the [documentation](https://idealo.github.io/imagededup/user_guide/benchmarks/).
Generally speaking, following conclusions can be made:

- CNN works best for near duplicates and datasets containing transformations.
- All deduplication methods fare well on datasets containing exact duplicates, but Difference hashing is the fastest.

## 🤝 Contribute

We welcome all kinds of contributions.
See the [Contribution](CONTRIBUTING.md) guide for more details.

## 📝 Citation

Please cite Imagededup in your publications if this is useful for your research. Here is an example BibTeX entry:

```BibTeX
@misc{idealods2019imagededup,
  title={Imagededup},
  author={Tanuj Jain and Christopher Lennan and Zubin John and Dat Tran},
  year={2019},
  howpublished={\url{https://github.com/idealo/imagededup}},
}
```

## 🏗 Maintainers

- Tanuj Jain, github: [tanujjain](https://github.com/tanujjain)
- Christopher Lennan, github: [clennan](https://github.com/clennan)
- Dat Tran, github: [datitran](https://github.com/datitran)

## © Copyright

See [LICENSE](LICENSE) for details.
