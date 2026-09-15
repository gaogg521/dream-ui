/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { detectMediaIntent } from '@/common/media/detectMediaIntent';

describe('detectMediaIntent', () => {
  describe('recognizes a request to generate an image', () => {
    it.each([
      '画一只猫',
      '画张图',
      '帮我生成一张海报',
      '做个logo',
      '设计一个头像',
      '来张壁纸',
      '生成图片：夕阳下的海滩',
      '绘制一幅插画',
      'draw a cat',
      'generate an image of a sunset',
      'create a poster for the launch',
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

  it('prefers video when both a generic verb and a video noun are present', () => {
    // "生成" alone would also satisfy the image rule; video must win.
    expect(detectMediaIntent('生成一段视频')).toBe('video');
    expect(detectMediaIntent('generate a video')).toBe('video');
  });

  it('ignores very long input rather than scanning a pasted document', () => {
    expect(detectMediaIntent(`${'x'.repeat(2001)}画一张图`)).toBeNull();
  });
});
