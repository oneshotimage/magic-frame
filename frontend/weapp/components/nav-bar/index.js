Component({
  data: {
    statusBarHeight: 0
  },

  properties: {
    title: {
      type: String,
      value: 'AI影像写真馆'
    },
    fixed: {
      type: Boolean,
      value: true
    },
    showBack: {
      type: Boolean,
      value: true
    },
    showMore: {
      type: Boolean,
      value: true
    },
    leftText: {
      type: String,
      value: '‹'
    },
    rightText: {
      type: String,
      value: '•••'
    }
  },

  lifetimes: {
    attached() {
      const info = wx.getSystemInfoSync ? wx.getSystemInfoSync() : {};
      this.setData({ statusBarHeight: info.statusBarHeight || 0 });
    }
  },

  methods: {
    onBack() {
      if (!this.data.showBack) return;
      this.triggerEvent('back');
    },

    onMore() {
      if (!this.data.showMore) return;
      this.triggerEvent('more');
    }
  }
});
