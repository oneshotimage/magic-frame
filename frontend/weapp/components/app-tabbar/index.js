const PAGE_PATHS = {
  home: '/pages/home/index',
  works: '/pages/works/index',
  profile: '/pages/profile/index'
};

Component({
  properties: {
    active: {
      type: String,
      value: 'home'
    }
  },

  methods: {
    onNavigate(event) {
      const page = event.currentTarget.dataset.page;
      if (!page || page === this.data.active) return;
      wx.switchTab({ url: PAGE_PATHS[page] });
    }
  }
});
