"use client";

import {
  Camera,
  Mesh,
  Plane,
  Program,
  Renderer,
  Texture,
  Transform,
  type OGLRenderingContext,
} from "ogl";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/* --------------------------------
 * Types
----------------------------------- */
export interface GalleryItem {
  image: string;
  text: string;
}

interface CircularGalleryProps
  extends React.HTMLAttributes<HTMLDivElement> {
  items?: GalleryItem[];
  /** 弧度：越大弯越明显 */
  bend?: number;
  /** 图片圆角（0.0 ~ 0.5） */
  borderRadius?: number;
  /** 滚动速度倍率 */
  scrollSpeed?: number;
  /** 滚动缓动（越小越顺滑） */
  scrollEase?: number;
  /** 点击（非拖动）命中某个条目：回调原始 items 下标 */
  onItemClick?: (originalIndex: number) => void;
  /** 当前选中条目（原始 items 下标；高亮描边） */
  selectedIndex?: number | null;
  fontClassName?: string;
}

/* --------------------------------
 * OGL Helper Utilities
----------------------------------- */
function lerp(p1: number, p2: number, t: number) {
  return p1 + (p2 - p1) * t;
}

function autoBind(instance: object) {
  const proto = Object.getPrototypeOf(instance);
  Object.getOwnPropertyNames(proto).forEach((key) => {
    if (key !== "constructor" && typeof (instance as Record<string, unknown>)[key] === "function") {
      (instance as Record<string, unknown>)[key] = ((instance as Record<string, unknown>)[key] as (...args: unknown[]) => unknown).bind(instance);
    }
  });
}

function createTextTexture(
  gl: OGLRenderingContext,
  text: string,
  font: string,
  color: string,
) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d")!;
  context.font = font;
  const metrics = context.measureText(text);
  const textWidth = Math.ceil(metrics.width);
  const textHeight = Math.ceil(parseInt(font, 10) * 1.2);
  canvas.width = textWidth + 20;
  canvas.height = textHeight + 20;
  context.font = font;
  context.fillStyle = color;
  context.textBaseline = "middle";
  context.textAlign = "center";
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillText(text, canvas.width / 2, canvas.height / 2);
  const texture = new Texture(gl, { generateMipmaps: false });
  texture.image = canvas;
  return { texture, width: canvas.width, height: canvas.height };
}

/* --------------------------------
 * OGL Classes
----------------------------------- */
class Title {
  gl: OGLRenderingContext;
  plane: Mesh;
  renderer: Renderer;
  text: string;
  textColor: string;
  font: string;
  mesh!: Mesh;

  constructor({
    gl,
    plane,
    renderer,
    text,
    textColor,
    font,
  }: {
    gl: OGLRenderingContext;
    plane: Mesh;
    renderer: Renderer;
    text: string;
    textColor: string;
    font: string;
  }) {
    autoBind(this);
    this.gl = gl;
    this.plane = plane;
    this.renderer = renderer;
    this.text = text;
    this.textColor = textColor;
    this.font = font;
    this.createMesh();
  }

  createMesh() {
    const { texture, width, height } = createTextTexture(
      this.gl,
      this.text,
      this.font,
      this.textColor,
    );
    const geometry = new Plane(this.gl);
    const program = new Program(this.gl, {
      vertex: `
        attribute vec3 position;
        attribute vec2 uv;
        uniform mat4 modelViewMatrix;
        uniform mat4 projectionMatrix;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragment: `
        precision highp float;
        uniform sampler2D tMap;
        varying vec2 vUv;
        void main() {
          vec4 color = texture2D(tMap, vUv);
          if (color.a < 0.1) discard;
          gl_FragColor = color;
        }
      `,
      uniforms: { tMap: { value: texture } },
      transparent: true,
      // 深度关闭：避免被平面纹理的 z 波动遮挡
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new Mesh(this.gl, { geometry, program });
    const aspect = width / height;
    const textHeight = this.plane.scale.y * 0.15;
    const textWidth = textHeight * aspect;
    this.mesh.scale.set(textWidth, textHeight, 1);
    // 项目名在文件夹上方（不被容器底缘裁掉）
    this.mesh.position.y = this.plane.scale.y * 0.5 + textHeight * 0.5 + 0.05;
    this.mesh.setParent(this.plane);
  }
}

class Media {
  gl: OGLRenderingContext;
  geometry: Plane;
  image: string;
  index: number;
  originalIndex: number;
  length: number;
  renderer: Renderer;
  scene: Transform;
  screen: { width: number; height: number };
  text: string;
  viewport: { width: number; height: number };
  bend: number;
  textColor: string;
  borderRadius: number;
  font: string;
  program!: Program;
  plane!: Mesh;
  title!: Title;
  extra: number = 0;
  widthTotal: number = 0;
  width: number = 0;
  x: number = 0;
  scale: number = 1;
  padding: number = 2;
  speed: number = 0;
  isBefore: boolean = false;
  isAfter: boolean = false;
  selected: boolean = false;
  /** 选中放大系数（只影响渲染，不改布局占位） */
  zoom: number = 1;
  baseX: number = 0;
  baseY: number = 0;

  constructor({
    geometry,
    gl,
    image,
    index,
    originalIndex,
    length,
    renderer,
    scene,
    screen,
    text,
    viewport,
    bend,
    textColor,
    borderRadius = 0,
    font,
  }: {
    geometry: Plane;
    gl: OGLRenderingContext;
    image: string;
    index: number;
    originalIndex: number;
    length: number;
    renderer: Renderer;
    scene: Transform;
    screen: { width: number; height: number };
    text: string;
    viewport: { width: number; height: number };
    bend: number;
    textColor: string;
    borderRadius: number;
    font: string;
  }) {
    this.geometry = geometry;
    this.gl = gl;
    this.image = image;
    this.index = index;
    this.originalIndex = originalIndex;
    this.length = length;
    this.renderer = renderer;
    this.scene = scene;
    this.screen = screen;
    this.text = text;
    this.viewport = viewport;
    this.bend = bend;
    this.textColor = textColor;
    this.borderRadius = borderRadius;
    this.font = font;
    this.createShader();
    this.createMesh();
    this.createTitle();
    this.onResize();
  }

  createShader() {
    // 关闭 mipmap：透明 PNG 的 mipmap 平均会把透明像素 RGB(0,0,0) 渗到边缘
    // 形成黑框；用原始分辨率线性采样保持真透明（文件夹卡片无底色）
    const texture = new Texture(this.gl, {
      generateMipmaps: false,
      minFilter: this.gl.LINEAR,
      magFilter: this.gl.LINEAR,
    });
    this.program = new Program(this.gl, {
      depthTest: false,
      depthWrite: false,
      vertex: `
        precision highp float;
        attribute vec3 position;
        attribute vec2 uv;
        uniform mat4 modelViewMatrix;
        uniform mat4 projectionMatrix;
        uniform float uTime;
        uniform float uSpeed;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec3 p = position;
          p.z = (sin(p.x * 4.0 + uTime) * 1.5 + cos(p.y * 2.0 + uTime) * 1.5) * (0.04 + uSpeed * 0.4);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragment: `
        precision highp float;
        uniform vec2 uImageSizes;
        uniform vec2 uPlaneSizes;
        uniform sampler2D tMap;
        varying vec2 vUv;

        void main() {
          vec2 ratio = vec2(
            min((uPlaneSizes.x / uPlaneSizes.y) / (uImageSizes.x / uImageSizes.y), 1.0),
            min((uPlaneSizes.y / uPlaneSizes.x) / (uImageSizes.y / uImageSizes.x), 1.0)
          );
          vec2 uv = vec2(
            vUv.x * ratio.x + (1.0 - ratio.x) * 0.5,
            vUv.y * ratio.y + (1.0 - ratio.y) * 0.5
          );
          vec4 color = texture2D(tMap, uv);

          // 卡片形状 = 纹理自身的 alpha（文件夹形状即背景，无矩形底板）
          gl_FragColor = vec4(color.rgb, color.a);
        }
      `,
      uniforms: {
        tMap: { value: texture },
        uPlaneSizes: { value: [0, 0] },
        uImageSizes: { value: [0, 0] },
        uSpeed: { value: 0 },
        uTime: { value: 100 * Math.random() },
      },
      transparent: true,
    });

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = this.image;
    img.onload = () => {
      texture.image = img;
      this.program.uniforms.uImageSizes.value = [
        img.naturalWidth,
        img.naturalHeight,
      ];
    };
  }

  createMesh() {
    this.plane = new Mesh(this.gl, {
      geometry: this.geometry,
      program: this.program,
    });
    this.plane.setParent(this.scene);
  }

  createTitle() {
    this.title = new Title({
      gl: this.gl,
      plane: this.plane,
      renderer: this.renderer,
      text: this.text,
      textColor: this.textColor,
      font: this.font,
    });
  }

  setSelected(v: boolean) {
    this.selected = v;
    // 选中放大（渲染级：不改布局占位 width/widthTotal，避免间距跳动）
    this.zoom = v ? 1.18 : 1;
    this.plane.scale.x = this.baseX * this.zoom;
    this.plane.scale.y = this.baseY * this.zoom;
    this.program.uniforms.uPlaneSizes.value = [this.plane.scale.x, this.plane.scale.y];
  }

  update(
    scroll: { current: number; last: number },
    direction: "left" | "right",
  ) {
    this.plane.position.x = this.x - scroll.current - this.extra;

    const x = this.plane.position.x;
    const H = this.viewport.width / 2;

    if (this.bend === 0) {
      this.plane.position.y = 0;
      this.plane.rotation.z = 0;
    } else {
      const B_abs = Math.abs(this.bend);
      const R = (H * H + B_abs * B_abs) / (2 * B_abs);
      const effectiveX = Math.min(Math.abs(x), H);
      const arc = R - Math.sqrt(R * R - effectiveX * effectiveX);

      if (this.bend > 0) {
        this.plane.position.y = -arc;
        this.plane.rotation.z = -Math.sign(x) * Math.asin(effectiveX / R);
      } else {
        this.plane.position.y = arc;
        this.plane.rotation.z = Math.sign(x) * Math.asin(effectiveX / R);
      }
    }
    // 整体下移：给选中放大的卡留出上缘空间（容器内不截断）
    this.plane.position.y -= this.viewport.height * 0.03;

    this.speed = scroll.current - scroll.last;
    this.program.uniforms.uTime.value += 0.04;
    this.program.uniforms.uSpeed.value = this.speed;

    const planeOffset = this.plane.scale.x / 2;
    const viewportOffset = this.viewport.width / 2;
    this.isBefore = this.plane.position.x + planeOffset < -viewportOffset;
    this.isAfter = this.plane.position.x - planeOffset > viewportOffset;

    if (direction === "right" && this.isBefore) {
      this.extra -= this.widthTotal;
      this.isBefore = this.isAfter = false;
    }
    if (direction === "left" && this.isAfter) {
      this.extra += this.widthTotal;
      this.isBefore = this.isAfter = false;
    }
  }

  onResize(
    {
      screen,
      viewport,
    }: {
      screen?: { width: number; height: number };
      viewport?: { width: number; height: number };
    } = {},
  ) {
    if (screen) this.screen = screen;
    if (viewport) {
      this.viewport = viewport;
      if ((this.plane.program.uniforms as Record<string, { value: number[] }>).uViewportSizes) {
        (
          this.plane.program.uniforms as Record<string, { value: number[] }>
        ).uViewportSizes.value = [this.viewport.width, this.viewport.height];
      }
    }
    // 平面尺寸：按容器视口比例（plane 高 = 视口 48%，宽 = 高×4/3 对齐文件夹纹理比例）；
    // plane 上方留给项目名 Title，下方留给弧形下沉
    this.scale = 1;
    this.baseY = this.viewport.height * 0.56;
    this.baseX = this.baseY * (400 / 300);
    this.plane.scale.y = this.baseY * this.zoom;
    this.plane.scale.x = this.baseX * this.zoom;
    this.program.uniforms.uPlaneSizes.value = [
      this.plane.scale.x,
      this.plane.scale.y,
    ];
    this.padding = 2;
    this.width = this.plane.scale.x + this.padding;
    this.widthTotal = this.width * this.length;
    this.x = this.width * this.index;
  }
}

class App {
  container: HTMLElement;
  scrollSpeed: number;
  onItemClick?: (originalIndex: number) => void;
  bendOf: number;
  textColor: string;
  borderRadius: number;
  font: string;
  /** 项目少时不翻倍不循环（滚动 clamp） */
  loop: boolean = true;
  scroll: { ease: number; current: number; target: number; last: number; position?: number };
  onCheckDebounce!: () => void;
  renderer!: Renderer;
  gl!: OGLRenderingContext;
  camera!: Camera;
  scene!: Transform;
  planeGeometry!: Plane;
  mediasImages!: GalleryItem[];
  originalLength!: number;
  medias!: Media[];
  isDown: boolean = false;
  start: number = 0;
  downX: number = 0;
  screen!: { width: number; height: number };
  viewport!: { width: number; height: number };
  raf!: number;
  selectedIndexState: number | null = null;
  boundOnResize!: () => void;
  boundOnWheel!: (e: WheelEvent) => void;
  boundOnTouchDown!: (e: MouseEvent | TouchEvent) => void;
  boundOnTouchMove!: (e: MouseEvent | TouchEvent) => void;
  boundOnTouchUp!: (e: MouseEvent | TouchEvent) => void;
  boundResizeObserver!: ResizeObserver;

  constructor(
    container: HTMLElement,
    {
      items,
      bend,
      textColor,
      borderRadius,
      font,
      scrollSpeed,
      scrollEase,
      onItemClick,
    }: {
      items?: GalleryItem[];
      bend: number;
      textColor: string;
      borderRadius: number;
      font: string;
      scrollSpeed: number;
      scrollEase: number;
      onItemClick?: (originalIndex: number) => void;
    },
  ) {
    this.container = container;
    this.scrollSpeed = scrollSpeed;
    this.onItemClick = onItemClick;
    this.bendOf = bend;
    this.textColor = textColor;
    this.borderRadius = borderRadius;
    this.font = font;
    this.scroll = { ease: scrollEase, current: 0, target: 0, last: 0 };

    autoBind(this);

    this.createRenderer();
    this.createCamera();
    this.createScene();
    this.onResize();
    this.createGeometry();
    this.createMedias(items, bend, textColor, borderRadius, font);
    this.update();
    this.addEventListeners();
  }

  createRenderer() {
    this.renderer = new Renderer({
      alpha: true,
      antialias: true,
      dpr: Math.min(window.devicePixelRatio || 1, 2),
    });
    this.gl = this.renderer.gl;
    this.gl.clearColor(0, 0, 0, 0);
    this.container.appendChild(this.gl.canvas);
  }

  createCamera() {
    this.camera = new Camera(this.gl);
    this.camera.fov = 45;
    this.camera.position.z = 20;
  }

  createScene() {
    this.scene = new Transform();
  }

  createGeometry() {
    this.planeGeometry = new Plane(this.gl, {
      heightSegments: 50,
      widthSegments: 100,
    });
  }

  createMedias(
    items: GalleryItem[] | undefined,
    bend: number,
    textColor: string,
    borderRadius: number,
    font: string,
  ) {
    const defaultItems: GalleryItem[] = [
      { image: `https://picsum.photos/seed/1/800/600?grayscale`, text: "Bridge" },
      {
        image: `https://picsum.photos/seed/2/800/600?grayscale`,
        text: "Desk Setup",
      },
      {
        image: `https://picsum.photos/seed/3/800/600?grayscale`,
        text: "Waterfall",
      },
    ];

    const galleryItems = items && items.length > 0 ? items : defaultItems;
    this.originalLength = galleryItems.length;
    this.mediasImages = [...galleryItems, ...galleryItems]; // Duplicate for seamless loop
    this.medias = this.mediasImages.map((data, index) => {
      return new Media({
        geometry: this.planeGeometry,
        gl: this.gl,
        image: data.image,
        index,
        originalIndex: index % this.originalLength,
        length: this.mediasImages.length,
        renderer: this.renderer,
        scene: this.scene,
        screen: this.screen,
        text: data.text,
        viewport: this.viewport,
        bend,
        textColor,
        borderRadius,
        font,
      });
    });
  }

  /** 同步选中态到所有副本（选中卡放大 + 纹理由宿主 items 更新承载） */
  setSelected(originalIndex: number | null) {
    this.selectedIndexState = originalIndex;
    if (!this.medias) return;
    for (const m of this.medias) {
      m.setSelected(m.originalIndex === originalIndex);
    }
  }

  /** items 更新（不重建 App、保留滚动位置）：重建 medias 纹理并恢复选中态。
   *  项目数少（单份周长 < 视口宽度 + 缓冲）时不翻倍：非循环模式 clamp 滚动，
   *  避免同一项目文件夹在左右两侧同时出现。 */
  updateItems(items?: GalleryItem[]) {
    const galleryItems = items && items.length > 0 ? items : this.mediasImages.slice(0, this.originalLength);
    this.originalLength = galleryItems.length;
    // 单卡估宽 ≈ 视口宽 / 4（最低可视 4 张）；数量 > 可视数 + 1 才翻倍循环
    const estWidth = this.viewport.width / 4;
    this.loop = galleryItems.length > Math.floor(this.viewport.width / estWidth) + 1;
    this.mediasImages = this.loop ? [...galleryItems, ...galleryItems] : [...galleryItems];
    // 清理旧 mesh
    for (const m of this.medias) {
      m.plane.setParent(null);
    }
    this.medias = this.mediasImages.map((data, index) => {
      return new Media({
        geometry: this.planeGeometry,
        gl: this.gl,
        image: data.image,
        index,
        originalIndex: this.loop ? index % this.originalLength : index,
        length: this.mediasImages.length,
        renderer: this.renderer,
        scene: this.scene,
        screen: this.screen,
        text: data.text,
        viewport: this.viewport,
        bend: this.bendOf,
        textColor: this.textColor,
        borderRadius: this.borderRadius,
        font: this.font,
      });
    });
    this.setSelected(this.selectedIndexState);
  }

  /** 把某个原始下标的卡转到视口正中（滚动目标对齐其中心） */
  centerOn(originalIndex: number) {
    if (!this.medias || !this.medias[0]) return;
    this.scroll.target = originalIndex * this.medias[0].width;
  }

  onTouchDown(e: MouseEvent | TouchEvent) {
    this.isDown = true;
    this.scroll.position = this.scroll.current;
    this.start = "touches" in e ? e.touches[0].clientX : e.clientX;
    this.downX = this.start;
  }

  onTouchMove(e: MouseEvent | TouchEvent) {
    if (!this.isDown) return;
    const x = "touches" in e ? e.touches[0].clientX : e.clientX;
    const distance = (this.start - x) * (this.scrollSpeed * 0.025);
    this.scroll.target = (this.scroll as unknown as { position: number }).position + distance;
  }

  onTouchUp(e: MouseEvent | TouchEvent) {
    this.isDown = false;
    // 点击（几乎没拖动）→ 命中检测（x + y 都在卡片范围内）→ 回调
    const upX = "changedTouches" in e ? e.changedTouches[0].clientX : e.clientX;
    const upY = "changedTouches" in e ? e.changedTouches[0].clientY : e.clientY;
    if (Math.abs(upX - this.downX) < 6 && this.onItemClick) {
      const rect = this.container.getBoundingClientRect();
      const vx = ((upX - rect.left) / rect.width) * this.viewport.width - this.viewport.width / 2;
      const vy = -(((upY - rect.top) / rect.height) * this.viewport.height - this.viewport.height / 2);
      for (const m of this.medias) {
        const halfW = m.plane.scale.x / 2;
        const halfH = m.plane.scale.y / 2;
        const cy = m.plane.position.y;
        if (
          m.plane.position.x + halfW > vx &&
          m.plane.position.x - halfW < vx &&
          cy + halfH > vy &&
          cy - halfH < vy
        ) {
          this.onItemClick(m.originalIndex);
          break;
        }
      }
    }
    this.onCheck();
  }

  onWheel(e: WheelEvent) {
    const delta = e.deltaY || (e as unknown as { wheelDelta: number }).wheelDelta || (e as unknown as { detail: number }).detail;
    this.scroll.target += (delta > 0 ? this.scrollSpeed : -this.scrollSpeed) * 0.2;
    this.onCheckDebounce();
  }

  onCheck() {
    if (!this.medias || !this.medias[0]) return;
    const width = this.medias[0].width;
    const itemIndex = Math.round(Math.abs(this.scroll.target) / width);
    const item = width * itemIndex;
    this.scroll.target = this.scroll.target < 0 ? -item : item;
  }

  onResize() {
    this.screen = {
      width: this.container.clientWidth,
      height: this.container.clientHeight,
    };
    this.renderer.setSize(this.screen.width, this.screen.height);
    this.camera.perspective({
      aspect: this.screen.width / this.screen.height,
    });
    const fov = (this.camera.fov * Math.PI) / 180;
    const height = 2 * Math.tan(fov / 2) * this.camera.position.z;
    const width = height * this.camera.aspect;
    // 宽度变化补偿：滚动位置按比例缩放（弧形顶点保持居中，选中卡保持在正中）
    const prevVw = this.viewport?.width;
    this.viewport = { width, height };
    if (this.medias) {
      this.medias.forEach((media) =>
        media.onResize({ screen: this.screen, viewport: this.viewport }),
      );
      if (prevVw && prevVw > 0 && prevVw !== width) {
        const ratio = width / prevVw;
        this.scroll.current *= ratio;
        this.scroll.target *= ratio;
        if (this.selectedIndexState !== null && this.selectedIndexState >= 0) {
          this.centerOn(this.selectedIndexState);
        }
      }
    }
  }

  update() {
    this.scroll.current = lerp(
      this.scroll.current,
      this.scroll.target,
      this.scroll.ease,
    );
    // 非循环模式（项目少）：滚动范围 clamp，两端不越界
    if (!this.loop && this.medias && this.medias[0]) {
      const maxScroll = (this.medias.length - 1) * this.medias[0].width;
      this.scroll.target = Math.max(0, Math.min(maxScroll, this.scroll.target));
      this.scroll.current = Math.max(0, Math.min(maxScroll, this.scroll.current));
    }
    const direction = this.scroll.current > this.scroll.last ? "right" : "left";
    if (this.medias) {
      this.medias.forEach((media) => media.update(this.scroll, direction));
    }
    this.renderer.render({ scene: this.scene, camera: this.camera });
    this.scroll.last = this.scroll.current;
    this.raf = window.requestAnimationFrame(this.update);
  }

  addEventListeners() {
    this.boundOnResize = this.onResize;
    this.boundOnWheel = this.onWheel;
    this.boundOnTouchDown = this.onTouchDown;
    this.boundOnTouchMove = this.onTouchMove;
    this.boundOnTouchUp = this.onTouchUp;

    window.addEventListener("resize", this.boundOnResize);
    // 容器尺寸观察：侧边栏开合 / 对话区分隔条拖动改变的是容器宽度（窗口没变），
    // window resize 收不到——必须 RO 才能跟随刷新
    this.boundResizeObserver = new ResizeObserver(() => this.onResize());
    this.boundResizeObserver.observe(this.container);
    window.addEventListener("mousewheel", this.boundOnWheel as EventListener);
    window.addEventListener("wheel", this.boundOnWheel as EventListener);
    this.container.addEventListener("mousedown", this.boundOnTouchDown);
    window.addEventListener("mousemove", this.boundOnTouchMove);
    window.addEventListener("mouseup", this.boundOnTouchUp as EventListener);
    this.container.addEventListener("touchstart", this.boundOnTouchDown);
    window.addEventListener("touchmove", this.boundOnTouchMove);
    window.addEventListener("touchend", this.boundOnTouchUp as EventListener);
  }

  destroy() {
    window.cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.boundOnResize);
    this.boundResizeObserver?.disconnect();
    window.removeEventListener("mousewheel", this.boundOnWheel as EventListener);
    window.removeEventListener("wheel", this.boundOnWheel as EventListener);
    this.container.removeEventListener("mousedown", this.boundOnTouchDown);
    window.removeEventListener("mousemove", this.boundOnTouchMove);
    window.removeEventListener("mouseup", this.boundOnTouchUp as EventListener);
    this.container.removeEventListener("touchstart", this.boundOnTouchDown);
    window.removeEventListener("touchmove", this.boundOnTouchMove);
    window.removeEventListener("touchend", this.boundOnTouchUp as EventListener);

    if (this.renderer && this.renderer.gl && this.renderer.gl.canvas.parentNode) {
      this.renderer.gl.canvas.parentNode.removeChild(this.renderer.gl.canvas);
    }
  }
}

/* --------------------------------
 * React Component
----------------------------------- */
const CircularGallery = ({
  items,
  bend = 3,
  borderRadius = 0.05,
  scrollSpeed = 2,
  scrollEase = 0.05,
  onItemClick,
  selectedIndex,
  className,
  fontClassName,
  ...props
}: CircularGalleryProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<App | null>(null);
  const clickRef = useRef(onItemClick);
  clickRef.current = onItemClick;
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // 建一次 App（items 变化走 updateItems，保留滚动/选中状态）
  useEffect(() => {
    if (!containerRef.current) return;

    const computedStyle = getComputedStyle(containerRef.current);
    const computedColor = computedStyle.color || "hsl(var(--foreground))";
    const computedFontWeight = computedStyle.fontWeight || "bold";
    const computedFontSize = computedStyle.fontSize || "30px";
    const computedFontFamily = computedStyle.fontFamily;

    const computedFont = `${computedFontWeight} ${computedFontSize} ${computedFontFamily}`;

    const app = new App(containerRef.current, {
      items: itemsRef.current,
      bend,
      textColor: computedColor,
      borderRadius,
      font: computedFont,
      scrollSpeed,
      scrollEase,
      onItemClick: (idx: number) => clickRef.current?.(idx),
    });
    appRef.current = app;

    return () => {
      app.destroy();
      appRef.current = null;
    };
  }, [bend, borderRadius, scrollSpeed, scrollEase, fontClassName]);

  // items / selectedIndex 变化：更新纹理 + 选中放大 + 把选中卡转到正中
  useEffect(() => {
    const app = appRef.current;
    if (!app) return;
    app.updateItems(items);
    app.setSelected(selectedIndex ?? null);
    if (typeof selectedIndex === "number" && selectedIndex >= 0) app.centerOn(selectedIndex);
  }, [items, selectedIndex]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "w-full h-full overflow-hidden cursor-grab active:cursor-grabbing",
        "text-foreground font-bold text-[30px]",
        fontClassName,
        className,
      )}
      {...props}
    />
  );
};

export { CircularGallery };