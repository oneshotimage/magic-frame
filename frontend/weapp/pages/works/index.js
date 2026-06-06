const { request, showToast, resolveAssetUrl } = require('../../utils/api');

const SAMPLE_IMAGES = [
  { key: 'sample-3d', url: '/assets/work-sample-3d.jpg', style: '3D 动画风', filter: '3d', theme: 'sample-3d' },
  { key: 'sample-film', url: '/assets/work-sample-film.jpg', style: '写实胶片', filter: 'film', theme: 'sample-film' },
  { key: 'sample-oil', url: '/assets/work-sample-oil.jpg', style: '古典油画', filter: 'film', theme: 'sample-oil' },
  { key: 'sample-cyber', url: '/assets/work-sample-cyber.jpg', style: '轻赛博朋克', filter: 'cyber', theme: 'sample-cyber' }
];

Page({
  data: {
    tasks: [],
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
      tasks.forEach((task) => {
        (task.images || []).forEach((image, index) => {
          const rawUrl = image.url || '';
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
