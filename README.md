# ComfyUI CP Multi Image Loader

简化版多图加载节点，核心是“可视化管理”：

- 点击按钮一次选择多张图
- UI 内显示图像列表和缩略图（双击缩略图可预览大图）
- 可继续添加、删除
- 可拖拽排序
- 删除/清空时会同步删除 `input` 目录中的对应文件
- 顶部输出一个总图像列表 `image_list`
- 同时按当前图数量生成单图输出口（最多 32 个）

## 节点名

- `CP Multi Image Loader`

## 使用方式

1. 添加节点后，点击 `添加图片`
2. 选择多张图片，会自动上传到 ComfyUI `input`
3. 在列表中拖拽调整顺序，点击 `删除` 移除
4. 连接输出：
   - `image_list`：所有图的 batch 输出
   - `image_1 ~ image_n`：逐张图输出（按当前图片数量动态显示，最多 32）

说明：多图会自动按第一张图片尺寸对齐，确保批量输出稳定。

## CP 兼容

- 上传接口使用 ComfyUI 标准 `/upload/image`
- 读取路径限制在 `input` 目录内（安全且兼容 CP）
- 不依赖额外第三方前端库

## 安装

1. 将本目录放到 `ComfyUI/custom_nodes/ComfyUI_RunningHUB_MultiImageLoader`
2. 重启 ComfyUI
3. 搜索并使用节点 `CP Multi Image Loader`
