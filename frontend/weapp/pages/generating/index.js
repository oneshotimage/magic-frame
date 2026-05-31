const { request, refreshCredits } = require('../../utils/api');
const { styles } = require('../../utils/constants');

Page({
  data: {
    task: {},
    styleNames: styles.reduce((map, item) => {
      map[item.id] = item.name;
      return map;
    }, {})
  },

  onLoad(options) {
    this.taskId = options.taskId || getApp().globalData.currentTask?.taskId;
    this.poll();
  },

  onUnload() {
    clearTimeout(this.timer);
  },

  poll() {
    if (!this.taskId) return;
    request({ url: `/generation/${this.taskId}` }).then((task) => {
      getApp().globalData.currentTask = task;
      this.setData({ task });
      if (['SUCCESS', 'FAILED', 'PARTIAL_SUCCESS', 'TIMEOUT', 'CANCELLED'].includes(task.status)) {
        refreshCredits().finally(() => {
          setTimeout(() => wx.redirectTo({ url: '/pages/result/index' }), 500);
        });
        return;
      }
      this.timer = setTimeout(() => this.poll(), 1200);
    });
  },

  cancelTask() {
    request({ url: `/generation/${this.taskId}/cancel`, method: 'POST' }).then((task) => {
      getApp().globalData.currentTask = task;
      wx.redirectTo({ url: '/pages/result/index' });
    });
  },

  viewResult() {
    wx.navigateTo({ url: '/pages/result/index' });
  }
});
