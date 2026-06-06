from __future__ import annotations


STYLE_PROMPTS = {
    "pixar": {
        "name": "3D皮克斯卡通",
        "color": "#FFB800",
        "prompt": "保留上传照片中人物身份特征，将人物重绘为高质量3D动画电影角色，柔和立体、明亮眼睛、精致布光，不要文字水印。",
    },
    "realistic": {
        "name": "高级写实插画",
        "color": "#FF7D45",
        "prompt": "保留人物五官比例、发型和姿态，生成高级写实插画写真，电影级光影、自然肤色、干净背景，不改变人物身份。",
    },
    "handdrawn": {
        "name": "文艺手绘质感",
        "color": "#A87532",
        "prompt": "保留人物身份特征，生成温柔文艺手绘写真，柔和线条、纸张纹理、淡雅配色、治愈氛围。",
    },
    "comic": {
        "name": "潮流涂鸦漫画",
        "color": "#222222",
        "prompt": "保留人物身份特征，生成潮流街头漫画风格，清晰轮廓、漫画分镜质感、适度涂鸦元素，不要品牌logo和文字。",
    },
}

PACKAGES = [
    {"packageId": "pkg_6_20", "name": "20次包", "priceFen": 600, "credits": 20},
    {"packageId": "pkg_12_50", "name": "50次包", "priceFen": 1200, "credits": 50},
    {"packageId": "pkg_19_100", "name": "100次包", "priceFen": 1900, "credits": 100},
]
