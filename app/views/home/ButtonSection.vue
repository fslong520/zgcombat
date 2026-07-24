<template>
  <div>
    <div class="button-section">
      <CTAButton
        href="/play"
        target=""
      >
        开始游戏
      </CTAButton>
      <CTAButton
        v-if="me.isTeacher()"
        href="/teachers/classes"
        target=""
      >
        教师班级
      </CTAButton>
      <CTAButton
        v-else-if="me.isStudent()"
        href="/students"
        target=""
      >
        学生课程
      </CTAButton>
      <CTAButton
        href="/play/dungeon"
        target=""
      >
        地牢战役
      </CTAButton>
    </div>
  </div>
</template>

<script>
import CTAButton from '../../components/common/buttons/CTAButton'
import utils from 'core/utils'

export default {
  name: 'ButtonSection',
  components: {
    CTAButton
  },
  computed: {
    utils () {
      return utils
    },
    me () {
      return me
    },
  },
}
</script>

<style scoped lang="scss">
@import 'app/styles/component_variables.scss';

.button-section {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 24px;
  margin-bottom: 24px;
}
</style>
