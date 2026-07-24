<template>
  <div
    class="footer-cmpt"
  >
    <div
      v-if="isBDPartner"
      class="footer-cmpt-bd"
    >
      {{ $t('payments.bd_help') }} <a
        href="mailto:partnerships@flsong.iok.la"
        class="footer-cmpt-bd__link"
      >partnerships@flsong.iok.la</a>
    </div>
  </div>
</template>

<script>
export default {
  name: 'FooterComponent',
  props: {
    isBDPartner: {
      type: Boolean,
      default: false
    }
  }
}
</script>

<style scoped lang="scss">
.footer-cmpt {
  padding-top: 20px;
  text-align: center;
  &-bd {
    &__link {
      display: inline-block;
    }
  }
}
</style>
