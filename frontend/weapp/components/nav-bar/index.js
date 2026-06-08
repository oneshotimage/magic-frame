Component({
  data: {
    statusBarHeight: 0
  },

  properties: {
    title: {
      type: String,
      value: '妙影工坊'
    },
    fixed: {
      type: Boolean,
      value: true
    },
    compact: {
      type: Boolean,
      value: false
    },
    showBack: {
      type: Boolean,
      value: true
    },
    variant: {
      type: String,
      value: ''
    },
    leftText: {
      type: String,
      value: '‹'
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
    }
  }
});
