function getAppSafe() {
  return getApp();
}

function request(options) {
  const app = getAppSafe();
  const baseUrl = app.globalData.apiBaseUrl || 'http://localhost:4180';
  const token = app.globalData.token || wx.getStorageSync('accessToken') || '';

  return new Promise((resolve, reject) => {
    wx.request({
      url: `${baseUrl}${options.url}`,
      method: options.method || 'GET',
      data: options.data || {},
      header: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(options.header || {})
      },
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
          return;
        }
        reject(res.data || { message: `HTTP ${res.statusCode}` });
      },
      fail: reject
    });
  });
}

function login() {
  return new Promise((resolve) => {
    wx.login({
      success(res) {
        resolve(res.code || `dev_${Date.now()}`);
      },
      fail() {
        resolve(`dev_${Date.now()}`);
      }
    });
  }).then((code) => request({
    url: '/auth/wechat-login',
    method: 'POST',
    data: {
      code,
      device: wx.getSystemInfoSync()
    }
  }));
}

function refreshCredits() {
  return request({ url: '/credits' }).then((credits) => {
    const app = getAppSafe();
    app.globalData.credits = credits;
    return credits;
  });
}

function creditText(credits) {
  if (!credits) return '0';
  if (credits.unlimited) return credits.displayText || '无限';
  return String(credits.balance ?? credits.totalCredits ?? 0);
}

function showToast(title) {
  wx.showToast({
    title,
    icon: 'none',
    duration: 1800
  });
}

function readFileAsBase64(filePath) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath,
      encoding: 'base64',
      success: (res) => resolve(res.data),
      fail: reject
    });
  });
}

function imageInfo(src) {
  return new Promise((resolve, reject) => {
    wx.getImageInfo({
      src,
      success: resolve,
      fail: reject
    });
  });
}

function compressImage(src) {
  return new Promise((resolve) => {
    wx.compressImage({
      src,
      quality: 82,
      success: (res) => resolve(res.tempFilePath || src),
      fail: () => resolve(src)
    });
  });
}

function uploadLocalImage(tempFilePath) {
  return compressImage(tempFilePath)
    .then((compressedPath) => Promise.all([readFileAsBase64(compressedPath), imageInfo(compressedPath)]))
    .then(([base64, info]) => {
      const mime = info.type === 'png' ? 'image/png' : 'image/jpeg';
      const dataUrl = `data:${mime};base64,${base64}`;
      return request({
        url: '/upload/image',
        method: 'POST',
        data: {
          dataUrl,
          width: info.width,
          height: info.height,
          sizeBytes: Math.round(base64.length * 0.75)
        }
      }).then((upload) => ({ upload, dataUrl }));
    });
}

function demoImageDataUrl() {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#FFF5E8"/><circle cx="512" cy="380" r="150" fill="#FFB800"/><circle cx="456" cy="350" r="20" fill="#222"/><circle cx="568" cy="350" r="20" fill="#222"/><path d="M440 460c54 42 120 42 160 0" fill="none" stroke="#222" stroke-width="18" stroke-linecap="round"/><text x="512" y="700" text-anchor="middle" font-family="Arial" font-size="54" font-weight="700" fill="#222">Demo Portrait</text></svg>';
  return `data:image/svg+xml;base64,${wx.arrayBufferToBase64(new Uint8Array(Array.from(svg).map((char) => char.charCodeAt(0))).buffer)}`;
}

module.exports = {
  request,
  login,
  refreshCredits,
  creditText,
  showToast,
  uploadLocalImage,
  demoImageDataUrl
};
