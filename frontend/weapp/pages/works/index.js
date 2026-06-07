const { request, showToast, resolveAssetUrl } = require('../../utils/api');

const SAMPLE_IMAGES = [
  { key: 'sample-3d', url: '/assets/work-sample-3d.jpg', style: '3D 动画风', filter: '3d', theme: 'sample-3d' },
  { key: 'sample-film', url: '/assets/work-sample-film.jpg', style: '写实胶片', filter: 'film', theme: 'sample-film' },
  { key: 'sample-oil', url: '/assets/work-sample-oil.jpg', style: '古典油画', filter: 'film', theme: 'sample-oil' },
  { key: 'sample-cyber', url: '/assets/work-sample-cyber.jpg', style: '轻赛博朋克', filter: 'cyber', theme: 'sample-cyber' }
];

const TERMINAL_TASK_STATUS = ['SUCCESS', 'FAILED', 'PARTIAL_SUCCESS', 'TIMEOUT', 'CANCELLED'];

Page({
  data: {
    tasks: [],
    runningTasks: [],
    images: [],
    displayImages: SAMPLE_IMAGES,
    totalCount: 12,
    loading: false,
    imageErrors: {},
    activeFilter: 'all',
    filters: [
      { id: 'all', name: '全部风格' },
      { id: '3d', name: '3D 动画' },
      { id: 'film', name: '写实胶片' },
      { id: 'cyber', name: '赛博朋克' }
    ]
  },

  onShow() {
    wx.hideTabBar({ animation: false, fail() {} });
    getApp().ensureLogin().then(() => this.load()).catch(() => {
      this.applyFilter(SAMPLE_IMAGES);
    });
  },

  onHide() {
    wx.showTabBar({ animation: false, fail() {} });
  },

  onUnload() {
    wx.showTabBar({ animation: false, fail() {} });
  },

  load() {
    this.setData({ loading: true });
    request({ url: '/generation/history' }).then((res) => {
      const tasks = res.items || res || [];
      const images = [];
      const runningTasks = [];
      tasks.forEach((task) => {
        if (!TERMINAL_TASK_STATUS.includes(String(task.status || '').toUpperCase())) {
          runningTasks.push(this.formatRunningTask(task));
        }
        (task.images || []).forEach((image, index) => {
          const rawUrl = image.url || '';
          if (!rawUrl) return;
          const url = resolveAssetUrl(rawUrl);
          images.push({
            ...image,
            key: image.imageId || `${task.taskId}_${index}`,
            url,
            rawUrl,
            filter: this.styleToFilter(image.style || image.styleId),
            taskId: task.taskId,
            createdAt: task.createdAt
          });
        });
      });
      const source = images.length ? images : SAMPLE_IMAGES;
      this.setData({
        tasks,
        runningTasks,
        images,
        totalCount: images.length || 12
      });
      this.applyFilter(source);
    }).catch((error) => {
      showToast(error.message || '作品加载失败');
      this.applyFilter(SAMPLE_IMAGES);
    }).finally(() => {
      this.setData({ loading: false });
    });
  },

  styleToFilter(style = '') {
    if (style.includes('pixar') || style.includes('3d') || style.includes('3D')) return '3d';
    if (style.includes('cyber') || style.includes('赛博')) return 'cyber';
    return 'film';
  },

  selectFilter(event) {
    const activeFilter = event.currentTarget.dataset.id;
    this.setData({ activeFilter });
    this.applyFilter(this.data.images.length ? this.data.images : SAMPLE_IMAGES, activeFilter);
  },

  applyFilter(source, filter = this.data.activeFilter) {
    const displayImages = filter === 'all' ? source : source.filter((item) => item.filter === filter);
    this.setData({ displayImages });
  },

  formatRunningTask(task = {}) {
    const status = String(task.status || 'RUNNING').toUpperCase();
    const progress = Math.max(0, Math.min(99, Math.round(Number(task.estimatedProgress || task.progress || 0))));
    const remainingMs = Math.max(0, Number(task.estimatedRemainingMs || 0));
    const imageCount = Array.isArray(task.images) ? task.images.length : 0;
    const styleText = (task.images || [])
      .map((image) => image.style || image.styleId)
      .filter(Boolean)
      .map((style) => this.styleName(style))
      .join('、');
    return {
      taskId: task.taskId,
      status,
      statusText: this.taskStatusText(status),
      progress,
      progressWidth: `${progress}%`,
      remainingText: remainingMs ? this.formatDuration(remainingMs) : '计算中',
      imageCount,
      styleText: styleText || `${imageCount || 1} 张写真`,
      createdText: this.formatDate(task.createdAt)
    };
  },

  styleName(style = '') {
    const styleMap = {
      pixar: '3D皮克斯',
      realistic: '写实插画',
      handdrawn: '文艺手绘',
      comic: '涂鸦漫画'
    };
    return styleMap[style] || style;
  },

  taskStatusText(status = '') {
    const normalizedStatus = String(status || '').toUpperCase();
    const statusMap = {
      QUEUED: '排队中',
      RUNNING: '生成中',
      PROCESSING: '生成中',
      PENDING: '等待中'
    };
    return statusMap[normalizedStatus] || '生成中';
  },

  formatDuration(ms = 0) {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes <= 0) return `${seconds}秒`;
    if (seconds === 0) return `${minutes}分钟`;
    return `${minutes}分${String(seconds).padStart(2, '0')}秒`;
  },

  formatDate(value = '') {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${month}-${day} ${hours}:${minutes}`;
  },

  openRunningTask(event) {
    const taskId = event.currentTarget.dataset.taskId;
    if (!taskId) return;
    const task = this.data.tasks.find((item) => item.taskId === taskId);
    if (task) {
      getApp().globalData.currentTask = task;
    }
    wx.navigateTo({ url: `/pages/generating/index?taskId=${taskId}` });
  },

  preview(event) {
    const url = event.currentTarget.dataset.url;
    if (!url) return;
    getApp().globalData.previewImage = url;
    wx.navigateTo({ url: '/pages/preview/index' });
  },

  onWorkImageError(event) {
    const { key, url, rawUrl } = event.currentTarget.dataset;
    console.warn('[works] image load failed', { key, url, rawUrl });
    this.setData({
      [`imageErrors.${key}`]: true
    });
  },

  create() {
    wx.switchTab({ url: '/pages/home/index' });
  },

  goBack() {
    wx.switchTab({ url: '/pages/home/index' });
  },

  goHome() {
    wx.switchTab({ url: '/pages/home/index' });
  },

  goProfile() {
    wx.switchTab({ url: '/pages/profile/index' });
  }
});
