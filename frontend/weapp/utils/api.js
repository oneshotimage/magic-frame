function getAppSafe() {
  return getApp();
}

function baseUrl() {
  const app = getAppSafe();
  return app.globalData.apiBaseUrl;
}

function normalizeNetworkError(error, fallback = '网络请求失败', requestUrl = '') {
  if (!error) return { message: fallback };
  const rawMessage = error.message || error.errMsg || fallback;
  const code = error.errCode || error.errno || error.code;
  const text = `${rawMessage} ${code || ''}`;
  let message = rawMessage;
  if (String(code) === '-109' || text.includes('-109')) {
    message = '真机无法访问后端地址，请检查手机网络、电脑防火墙或改用 HTTPS 域名';
  } else if (/timeout|timed out|超时/i.test(rawMessage)) {
    message = '请求超时，请检查后端地址和网络';
  }
  return { ...error, message, requestUrl };
}

function resolveAssetUrl(url = '') {
  if (!url || typeof url !== 'string') return '';
  if (url.startsWith('data:image/')) return url;
  if (url.startsWith('/assets/generated/') || url.startsWith('/assets/object/')) {
    return `${baseUrl()}${url}`;
  }
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    const isLocalAsset = parsed.pathname.startsWith('/assets/generated/') || parsed.pathname.startsWith('/assets/object/');
    const isLocalHost = host === 'localhost' || host === '0.0.0.0' || host.startsWith('127.');
    const isPrivateLan = host.startsWith('192.168.') || host.startsWith('10.') || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
    if (isLocalAsset && (isLocalHost || isPrivateLan)) {
      return url;
    }
  } catch (error) {
    return url;
  }
  return url;
}

function saveSession(data) {
  const app = getAppSafe();
  if (data.accessToken) {
    app.globalData.token = data.accessToken;
    wx.setStorageSync('accessToken', data.accessToken);
  }
  if (data.refreshToken) {
    wx.setStorageSync('refreshToken', data.refreshToken);
  }
  if (data.user) {
    app.globalData.user = data.user;
  }
  if (data.credits) {
    app.globalData.credits = data.credits;
  }
  return data;
}

function rawRequest(options) {
  const app = getAppSafe();
  const apiBaseUrl = baseUrl();
  const token = app.globalData.token || wx.getStorageSync('accessToken') || '';
  const requestUrl = `${apiBaseUrl}${options.url}`;

  return new Promise((resolve, reject) => {
    wx.request({
      url: requestUrl,
      method: options.method || 'GET',
      data: options.data || {},
      timeout: options.timeout || 15000,
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
        reject({ ...(res.data || { message: `HTTP ${res.statusCode}` }), statusCode: res.statusCode });
      },
      fail: (error) => reject(normalizeNetworkError(error, '网络请求失败', requestUrl))
    });
  });
}

function refreshSession() {
  const refreshToken = wx.getStorageSync('refreshToken') || '';
  if (!refreshToken) {
    return Promise.reject({ code: 'UNAUTHORIZED', message: '登录已过期，请重新登录' });
  }
  return rawRequest({
    url: '/auth/refresh',
    method: 'POST',
    data: { refreshToken },
    skipAuthRefresh: true
  }).then(saveSession).catch((error) => {
    getAppSafe().clearSession();
    return Promise.reject(error);
  });
}

function request(options) {
  return rawRequest(options).catch((error) => {
    if (options.skipAuthRefresh || options.url === '/auth/refresh' || options.url === '/auth/wechat-login') {
      return Promise.reject(error);
    }
    if (error.statusCode !== 401 && error.code !== 'UNAUTHORIZED') {
      return Promise.reject(error);
    }
    return refreshSession().then(() => rawRequest({ ...options, skipAuthRefresh: true }));
  });
}

function uploadFile(options) {
  const app = getAppSafe();
  const apiBaseUrl = baseUrl();
  const token = app.globalData.token || wx.getStorageSync('accessToken') || '';
  const requestUrl = `${apiBaseUrl}${options.url}`;

  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: requestUrl,
      filePath: options.filePath,
      name: options.name || 'file',
      formData: options.formData || {},
      timeout: options.timeout || 30000,
      header: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(options.header || {})
      },
      success(res) {
        let data = {};
        try {
          data = JSON.parse(res.data || '{}');
        } catch (error) {
          data = { message: res.data || '上传失败' };
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
          return;
        }
        reject({ ...(data || { message: `HTTP ${res.statusCode}` }), statusCode: res.statusCode });
      },
      fail: (error) => reject(normalizeNetworkError(error, '上传失败', requestUrl))
    });
  }).catch((error) => {
    if (options.skipAuthRefresh || error.statusCode !== 401) {
      return Promise.reject(error);
    }
    return refreshSession().then(() => uploadFile({ ...options, skipAuthRefresh: true }));
  });
}

function login(userInfo = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject({ message: '微信登录超时，请检查网络后重试' }), 5000);
    wx.login({
      success(res) {
        clearTimeout(timer);
        if (res.code) {
          resolve(res.code);
          return;
        }
        reject({ message: '微信登录失败，未获取到登录 code' });
      },
      fail(error) {
        clearTimeout(timer);
        reject(normalizeNetworkError(error, '微信登录失败'));
      }
    });
  }).then((code) => request({
    url: '/auth/wechat-login',
    method: 'POST',
    timeout: 15000,
    data: {
      code,
      bindAccessToken: getAppSafe().globalData.token || wx.getStorageSync('accessToken') || '',
      device: wx.getSystemInfoSync(),
      userInfo
    }
  })).then(saveSession);
}

function logout() {
  return request({ url: '/auth/logout', method: 'POST' }).catch(() => ({ ok: false })).finally(() => {
    getAppSafe().clearSession();
  });
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
      quality: 45,
      success: (res) => resolve(res.tempFilePath || src),
      fail: () => resolve(src)
    });
  });
}

function uploadLocalImage(tempFilePath) {
  return compressImage(tempFilePath)
    .then((compressedPath) => imageInfo(compressedPath).then((info) => ({ compressedPath, info })))
    .then(({ compressedPath, info }) => uploadFile({
      url: '/upload/file',
      filePath: compressedPath,
      formData: {
        width: String(info.width || 0),
        height: String(info.height || 0)
      }
    }).then((upload) => ({ upload, dataUrl: compressedPath })).catch(() => {
      return readFileAsBase64(compressedPath).then((base64) => {
        if (base64.length > 330000) {
          return Promise.reject({ message: '图片过大，请换一张更小的照片' });
        }
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
    }));
}

function demoImageDataUrl() {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#FFF5E8"/><circle cx="512" cy="380" r="150" fill="#FFB800"/><circle cx="456" cy="350" r="20" fill="#222"/><circle cx="568" cy="350" r="20" fill="#222"/><path d="M440 460c54 42 120 42 160 0" fill="none" stroke="#222" stroke-width="18" stroke-linecap="round"/><text x="512" y="700" text-anchor="middle" font-family="Arial" font-size="54" font-weight="700" fill="#222">Demo Portrait</text></svg>';
  return `data:image/svg+xml;base64,${wx.arrayBufferToBase64(new Uint8Array(Array.from(svg).map((char) => char.charCodeAt(0))).buffer)}`;
}

module.exports = {
  request,
  login,
  logout,
  refreshCredits,
  creditText,
  resolveAssetUrl,
  showToast,
  uploadLocalImage,
  demoImageDataUrl
};
