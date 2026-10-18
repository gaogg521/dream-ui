/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { detectMediaIntent, isLayoutRequest } from '@/common/media/detectMediaIntent';

describe('detectMediaIntent', () => {
  describe('recognizes a request to generate an image', () => {
    it.each([
      '画一只猫',
      '画张图',
      '帮我生成一张猫咪插画',
      '做个logo',
      '设计一个头像',
      '来张壁纸',
      '生成图片：夕阳下的海滩',
      '绘制一幅插画',
      'draw a cat',
      'generate an image of a sunset',
      'create an illustration for the launch',
      'make me a logo',
      'Draw a picture of a mountain',
    ])('%s', (input) => {
      expect(detectMediaIntent(input)).toBe('image');
    });
  });

  describe('recognizes a request to generate a video', () => {
    it.each([
      '生成一段视频',
      '做个短片',
      '帮我做一个动画',
      '来段视频，内容是海浪',
      'generate a video of a city at night',
      'create a short clip',
      'make an animation',
    ])('%s', (input) => {
      expect(detectMediaIntent(input)).toBe('video');
    });
  });

  /**
   * 这些句子里有图像名词，但要的是「看」不是「画」——交给视觉模型。
   * These name an image but ask to read one, which is a vision model's job.
   */
  describe('does not fire on reading an existing image', () => {
    it.each([
      '分析这张图片',
      '这张图里有什么',
      '看看这个截图',
      '描述一下图片内容',
      '帮我识别图中的文字',
      '这个视频讲了什么',
      '提取图片里的表格',
      'what is in this image',
      'describe the picture',
      'analyze this screenshot',
      'read the text in the image',
    ])('%s', (input) => {
      expect(detectMediaIntent(input)).toBeNull();
    });
  });

  /**
   * 代码语境里的「画图」要的是绘图代码，不是图片文件。切模式会把一个能用的
   * 答案换成一张图。
   * "Draw a chart" in a coding request wants plotting code, not a picture.
   */
  describe('does not fire on coding requests that mention drawing', () => {
    it.each([
      '写个函数画折线图',
      '用 matplotlib 画个柱状图',
      '帮我写一个 React 组件，渲染一张图片',
      'write code to generate an image thumbnail',
      'create a canvas element and draw a picture',
    ])('%s', (input) => {
      expect(detectMediaIntent(input)).toBeNull();
    });
  });

  describe('does not fire on ordinary conversation', () => {
    it.each([
      '你好',
      '今天天气怎么样',
      '帮我总结这段文字',
      '这个 bug 怎么修',
      'explain how promises work',
      'refactor this function',
      '',
      '   ',
    ])('%s', (input) => {
      expect(detectMediaIntent(input)).toBeNull();
    });
  });

  /**
   * 「画」出现在很多不是「画画」的词里。这些如果误判，用户会莫名其妙被切进图片模式。
   * The character 画 appears in many words that are not about drawing.
   */
  describe('does not fire on words that merely contain the draw character', () => {
    it.each([
      '这个画面太暗了',
      '我的计划是下周发布',
      '推荐几部动画',
      '这本漫画不错',
      '画质怎么样',
      '他是个画家',
      'draw a conclusion from the data',
      'this will draw attention',
      'draw a comparison between the two',
    ])('%s', (input) => {
      expect(detectMediaIntent(input)).toBeNull();
    });
  });

  /**
   * 日历、小报、海报这类版面上的字和日期必须准确，图像模型做不到（实测：2027 年
   * 2 月画出 29 天）。它们留在对话里由 Agent 用 HTML 排版再出 PNG，不弹切换。
   * Text-heavy layouts stay with the chat agent (HTML, then PNG): an image model
   * drew a 29-day February for 2027.
   */
  describe('leaves text-heavy layouts to the chat agent', () => {
    it.each([
      '做一个2027年日历小报',
      '画一份2027年的年历',
      '帮我生成一张活动海报',
      '设计一张手抄报，主题是垃圾分类',
      '生成一张信息图，介绍光合作用',
      '做个奶茶店的价目表图片',
      '生成一张婚礼邀请函',
      'create a poster for the launch',
      'generate an infographic about sleep',
      'design a menu image for my cafe',
    ])('%s', (input) => {
      expect(isLayoutRequest(input)).toBe(true);
      expect(detectMediaIntent(input)).toBeNull();
    });

    it('still routes a video request about a poster to video', () => {
      expect(detectMediaIntent('把这张海报做成一段视频')).toBe('video');
      expect(detectMediaIntent('生成一段海报风格的视频')).toBe('video');
    });

    it('does not flag ordinary pictures as layouts', () => {
      expect(isLayoutRequest('画一只猫')).toBe(false);
      expect(isLayoutRequest('generate an image of a sunset')).toBe(false);
    });
  });

  it('prefers video when both a generic verb and a video noun are present', () => {
    // "生成" alone would also satisfy the image rule; video must win.
    expect(detectMediaIntent('生成一段视频')).toBe('video');
    expect(detectMediaIntent('generate a video')).toBe('video');
  });

  it('ignores very long input rather than scanning a pasted document', () => {
    expect(detectMediaIntent(`${'x'.repeat(2001)}画一张图`)).toBeNull();
  });
});
