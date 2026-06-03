Component({
  properties: {
    text: {
      type: String,
      value: '开始制作'
    },
    icon: {
      type: String,
      value: '→'
    },
    variant: {
      type: String,
      value: 'primary'
    },
    loading: {
      type: Boolean,
      value: false
    },
    disabled: {
      type: Boolean,
      value: false
    },
    openType: {
      type: String,
      value: ''
    },
    value: {
      type: String,
      value: ''
    }
  },

  methods: {
    onTap(event) {
      if (this.data.disabled || this.data.loading) return;
      this.triggerEvent('press', {
        value: this.data.value,
        dataset: event.currentTarget.dataset
      });
    }
  }
});
