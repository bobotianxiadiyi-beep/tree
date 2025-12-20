import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { gsap } from 'gsap';

// 检测是否为移动设备
const isMobile = () => {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) 
    || window.innerWidth < 768;
};

// 根据设备类型设置粒子数量和尺寸
const PARTICLE_COUNT = isMobile() ? 1200 : 5000;  // 手机端用1200，PC端用5000
const SNOW_COUNT = isMobile() ? 300 : 1000;       // 雪花也相应减少
const TREE_HEIGHT = isMobile() ? 20 : 25;         // 手机端树更矮一些
const TREE_RADIUS = isMobile() ? 8 : 10;          // 手机端树更窄一些

// Custom Shader Material for glowing golden particles
const particleVertexShader = `
  attribute float size;
  attribute float alpha;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vSize;
  
  void main() {
    vColor = color;
    vAlpha = alpha;
    vSize = size;
    
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * (300.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const particleFragmentShader = `
  uniform float time;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vSize;
  
  void main() {
    vec2 center = gl_PointCoord - vec2(0.5);
    float dist = length(center);
    
    // Enhanced glowing effect with softer, brighter edges
    float alpha = vAlpha * (1.0 - smoothstep(0.0, 0.6, dist));
    
    // Multiple twinkle frequencies for rich sparkle effect
    float twinkle1 = sin(time * 4.0 + vSize * 15.0) * 0.4 + 0.6;
    float twinkle2 = sin(time * 6.5 + vSize * 8.0) * 0.3 + 0.7;
    float twinkle3 = sin(time * 2.0 + vSize * 20.0) * 0.2 + 0.8;
    float combinedTwinkle = (twinkle1 + twinkle2 + twinkle3) / 3.0;
    
    // Preserve original colors while adding sparkle
    // Only apply golden tint to particles that are already gold/yellow
    float isGold = step(0.5, vColor.r + vColor.g - vColor.b); // Detect gold/yellow colors
    vec3 goldenBoost = vec3(1.0, 0.9, 0.6);
    vec3 colorBoost = mix(vColor, vColor * goldenBoost, isGold * 0.6); // Only boost gold colors
    
    vec3 sparkleColor = colorBoost * (1.0 + combinedTwinkle * 0.8);
    
    // Add inner glow for extra shine (white glow, preserves color)
    float innerGlow = 1.0 - smoothstep(0.0, 0.3, dist);
    sparkleColor += vec3(1.0, 1.0, 1.0) * innerGlow * 0.3; // White glow, less intense
    
    alpha *= (0.8 + combinedTwinkle * 0.4);
    
    gl_FragColor = vec4(sparkleColor, alpha);
  }
`;

// 3D Noise function for explosion state
function noise3D(x: number, y: number, z: number): number {
  const n = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return n - Math.floor(n);
}

const GestureTree: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  
  // UI States
  const [isTreeFormed, setIsTreeFormed] = useState(false);
  const [currentTheme, setCurrentTheme] = useState<string>('经典圣诞');
  const [isSnowing, setIsSnowing] = useState(false);

  // Logic Refs
  const pinchStrengthRef = useRef(0);
  const rotationTargetRef = useRef({ x: 0, y: 0 });
  const rotationCurrentRef = useRef({ x: 0, y: 0 });
  const timeRef = useRef(0);
  const colorThemeRef = useRef(0);
  const isSnowingRef = useRef(false);
  const isDraggingRef = useRef(false);
  const lastMouseRef = useRef({ x: 0, y: 0 });
  
  // Three.js Refs
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const composerRef = useRef<EffectComposer | null>(null);
  const particlesRef = useRef<THREE.Points | null>(null);
  const treeGroupRef = useRef<THREE.Group | null>(null);
  const starRef = useRef<THREE.Sprite | null>(null);
  const trunkRef = useRef<THREE.Mesh | null>(null);
  const snowParticlesRef = useRef<THREE.Points | null>(null);
  const fireworksRef = useRef<any[]>([]);
  
  // Particle system data
  const positionsRef = useRef<Float32Array | null>(null);
  const velocitiesRef = useRef<Float32Array | null>(null);
  const targetTreeRef = useRef<Float32Array | null>(null);
  const targetExplodedRef = useRef<Float32Array | null>(null);
  const sizesRef = useRef<Float32Array | null>(null);
  const alphasRef = useRef<Float32Array | null>(null);

  // 1. Initialize Three.js with Post-Processing
  useEffect(() => {
    if (!containerRef.current) return;

    // Scene Setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    scene.fog = new THREE.FogExp2(0x000000, 0.02);
    sceneRef.current = scene;

    // 相机设置 - 手机端调整视角和距离
    const camera = new THREE.PerspectiveCamera(
      isMobile() ? 70 : 60,  // 手机端视野更广
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    camera.position.set(0, 0, isMobile() ? 40 : 35);  // 手机端相机拉远
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ 
      antialias: !isMobile(), // 移动端关闭抗锯齿以提升性能
      powerPreference: 'high-performance',
        alpha: false, 
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    // 移动端使用更低的像素比
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile() ? 1.5 : 2));
    renderer.setClearColor(0x000000);
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Post-Processing Setup (UnrealBloomPass for cinematic glow)
    const composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    // 移动端使用更轻量的 Bloom 效果
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      isMobile() ? 1.8 : 2.2, // 移动端降低强度
      isMobile() ? 0.4 : 0.5, // 移动端缩小半径
      isMobile() ? 0.75 : 0.7 // 移动端提高阈值
    );
    composer.addPass(bloomPass);
    composerRef.current = composer;

    // Particle System Setup
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const velocities = new Float32Array(PARTICLE_COUNT * 3);
    const targetTree = new Float32Array(PARTICLE_COUNT * 3);
    const targetExploded = new Float32Array(PARTICLE_COUNT * 3);
    const colors = new Float32Array(PARTICLE_COUNT * 3);
    const sizes = new Float32Array(PARTICLE_COUNT);
    const alphas = new Float32Array(PARTICLE_COUNT);
    
    const colorGold = new THREE.Color(0xFFD700);
    const colorWhite = new THREE.Color(0xFFFFFF);
    const colorRed = new THREE.Color(0xFF6B6B);
    const colorGreen = new THREE.Color(0x4ECDC4);
    const tempColor = new THREE.Color();

    // Initialize particle positions and targets
    for (let i = 0; i < PARTICLE_COUNT; i++) {
        const i3 = i * 3;

      // Tree Shape: Linear Cone with Volume-based Density Distribution
      const randomCheck = Math.random();
      const layerPct = (i / PARTICLE_COUNT);
      
      if (randomCheck > (1 - layerPct * 0.7)) {
        const redistributedPct = Math.random() * 0.5;
        const actualLayerPct = redistributedPct;
        const layerIndex = Math.floor(actualLayerPct * 12);
        const normalizedY = layerIndex / 12;
        
        const linearFactor = 1 - normalizedY;
        const curvedFactor = Math.pow(1 - normalizedY, 1.3);
        const layerRadiusMax = TREE_RADIUS * (linearFactor * 0.8 + curvedFactor * 0.2);
        
        const GOLDEN_ANGLE = 2.399963229728653;
        const angle = i * GOLDEN_ANGLE;
        const r = layerRadiusMax * Math.sqrt(Math.random());
        
        let y = -TREE_HEIGHT / 2 + (normalizedY * TREE_HEIGHT);
        const droop = r * 0.4;
        y -= droop;
        
        const yRandomness = (Math.random() - 0.5) * 0.6;
        const depthJitter = (Math.random() - 0.5) * (0.8 + normalizedY * 1.2);
        
        targetTree[i3] = Math.cos(angle) * r + depthJitter * 0.3;
        targetTree[i3 + 1] = y + yRandomness;
        targetTree[i3 + 2] = Math.sin(angle) * r + depthJitter * 0.3;
      } else {
        const layerIndex = Math.floor(layerPct * 12);
        const normalizedY = layerIndex / 12;
        
        const linearFactor = 1 - normalizedY;
        const curvedFactor = Math.pow(1 - normalizedY, 1.3);
        const layerRadiusMax = TREE_RADIUS * (linearFactor * 0.8 + curvedFactor * 0.2);
        
        const minRadius = 0.2;
        const finalRadius = Math.max(minRadius, layerRadiusMax);
        
        const GOLDEN_ANGLE = 2.399963229728653;
        const angle = i * GOLDEN_ANGLE;
        const r = finalRadius * Math.sqrt(Math.random());
        
        let y = -TREE_HEIGHT / 2 + (normalizedY * TREE_HEIGHT);
        const droop = r * 0.4;
        y -= droop;
        
        const yRandomness = (Math.random() - 0.5) * 0.6;
        const depthJitter = (Math.random() - 0.5) * (0.8 + normalizedY * 1.2);
        
        targetTree[i3] = Math.cos(angle) * r + depthJitter * 0.3;
        targetTree[i3 + 1] = y + yRandomness;
        targetTree[i3 + 2] = Math.sin(angle) * r + depthJitter * 0.3;
      }

      // Exploded State (3D Noise Distribution)
      const spread = 60;
      const noiseX = noise3D(i, 0, 0);
      const noiseY = noise3D(0, i, 0);
      const noiseZ = noise3D(0, 0, i);
      
      targetExploded[i3] = (noiseX - 0.5) * spread;
      targetExploded[i3 + 1] = (noiseY - 0.5) * spread;
      targetExploded[i3 + 2] = (noiseZ - 0.5) * spread;

      // Start in exploded state
      positions[i3] = targetExploded[i3];
      positions[i3 + 1] = targetExploded[i3 + 1];
      positions[i3 + 2] = targetExploded[i3 + 2];

      // Initial velocities (zero)
      velocities[i3] = 0;
      velocities[i3 + 1] = 0;
      velocities[i3 + 2] = 0;

      // Colors (Christmas theme - balanced distribution)
        const rand = Math.random();
      if (rand > 0.7) {
        tempColor.copy(colorWhite).multiplyScalar(1.3);
      } else if (rand > 0.4) {
        tempColor.copy(colorGold).multiplyScalar(1.5);
      } else if (rand > 0.25) {
        tempColor.copy(colorRed).multiplyScalar(1.2);
      } else {
        tempColor.copy(colorGreen);
      }

        colors[i3] = tempColor.r;
      colors[i3 + 1] = tempColor.g;
      colors[i3 + 2] = tempColor.b;

      // Sizes and alphas (variation for depth)
      sizes[i] = 0.8 + Math.random() * 0.6;
      alphas[i] = 0.7 + Math.random() * 0.3;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1));

    // Custom Shader Material
    const material = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
      },
      vertexShader: particleVertexShader,
      fragmentShader: particleFragmentShader,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
      vertexColors: true,
    });

    const particles = new THREE.Points(geometry, material);
    particlesRef.current = particles;
    
    // Group for rotation
    const treeGroup = new THREE.Group();
    treeGroup.add(particles);
    // 向上移动整棵树，手机端位置稍微低一点以适配底部按钮
    treeGroup.position.y = isMobile() ? 0 : 2;
    scene.add(treeGroup);
    treeGroupRef.current = treeGroup;

    // Store refs
    positionsRef.current = positions;
    velocitiesRef.current = velocities;
    targetTreeRef.current = targetTree;
    targetExplodedRef.current = targetExploded;
    sizesRef.current = sizes;
    alphasRef.current = alphas;

    // Star Sprite (brighter at tree top)
    const starCanvas = document.createElement('canvas');
    starCanvas.width = 128;
    starCanvas.height = 128;
    const starCtx = starCanvas.getContext('2d');
    if (starCtx) {
      const grad = starCtx.createRadialGradient(64, 64, 0, 64, 64, 64);
      grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
      grad.addColorStop(0.3, 'rgba(255, 215, 0, 0.9)');
      grad.addColorStop(0.6, 'rgba(255, 215, 0, 0.3)');
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      starCtx.fillStyle = grad;
      starCtx.fillRect(0, 0, 128, 128);
    }
    const starTexture = new THREE.CanvasTexture(starCanvas);
    const starMaterial = new THREE.SpriteMaterial({
      map: starTexture,
      blending: THREE.AdditiveBlending,
      transparent: true,
    });
    const star = new THREE.Sprite(starMaterial);
    star.scale.set(0, 0, 1);
    star.position.set(0, TREE_HEIGHT / 2 + 0.5, 0);
    treeGroup.add(star);
    starRef.current = star;

    // Tree Trunk (长度9，明显可见)
    // 高度 9，从树底部向下延伸
    const trunkGeometry = new THREE.CylinderGeometry(1.0, 1.6, 9, 16);
    const trunkMaterial = new THREE.MeshStandardMaterial({
      color: 0x4A2511, // 深棕色
      roughness: 0.9,
      metalness: 0.1,
    });
    const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
    // 位置：树底部在 -12.5，树干高度9，中心在 -12.5 - 4.5 = -17
    // 树干从 -21.5 延伸到 -12.5（刚好连接树底部）
    trunk.position.set(0, -TREE_HEIGHT / 2 - 4.5, 0);
    trunk.visible = false;
    treeGroup.add(trunk);
    trunkRef.current = trunk;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
    scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
    directionalLight.position.set(5, 10, 5);
    scene.add(directionalLight);

    // Snow Particle System
    const snowGeometry = new THREE.BufferGeometry();
    const snowPositions = new Float32Array(SNOW_COUNT * 3);
    
    for (let i = 0; i < SNOW_COUNT; i++) {
      snowPositions[i * 3] = (Math.random() - 0.5) * 60;
      snowPositions[i * 3 + 1] = Math.random() * 40 + 10;
      snowPositions[i * 3 + 2] = (Math.random() - 0.5) * 60;
    }
    
    snowGeometry.setAttribute('position', new THREE.BufferAttribute(snowPositions, 3).setUsage(THREE.DynamicDrawUsage));
    
    const snowMaterial = new THREE.PointsMaterial({
      size: 0.3,
      color: 0xffffff,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
    });
    
    const snowParticles = new THREE.Points(snowGeometry, snowMaterial);
    snowParticles.visible = false;
    scene.add(snowParticles);
    snowParticlesRef.current = snowParticles;

    // Animation Loop with Physics
    let animationFrameId: number;
    const GRAVITY_STRENGTH = 0.35;
    const EXPLOSION_STRENGTH = 0.25;
    const DAMPING = 0.90;
    const BROWN_MOTION = 0.03;
    
    const animate = () => {
        animationFrameId = requestAnimationFrame(animate);
      timeRef.current += 0.016;

      if (!rendererRef.current || !composerRef.current) return;

      const positions = positionsRef.current!;
      const velocities = velocitiesRef.current!;
      const targetTree = targetTreeRef.current!;
      const targetExploded = targetExplodedRef.current!;
      const material = particlesRef.current!.material as THREE.ShaderMaterial;

      material.uniforms.time.value = timeRef.current;

      const pinchStrength = pinchStrengthRef.current;
        
        for (let i = 0; i < PARTICLE_COUNT; i++) {
            const i3 = i * 3;
        const x = positions[i3];
        const y = positions[i3 + 1];
        const z = positions[i3 + 2];

        let targetX, targetY, targetZ;
        
        if (pinchStrength > 0.01) {
          targetX = targetTree[i3];
          targetY = targetTree[i3 + 1];
          targetZ = targetTree[i3 + 2];

          const dx = targetX - x;
          const dy = targetY - y;
          const dz = targetZ - z;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

          if (dist > 0.01) {
            const force = GRAVITY_STRENGTH * pinchStrength;
            velocities[i3] += (dx / dist) * force;
            velocities[i3 + 1] += (dy / dist) * force;
            velocities[i3 + 2] += (dz / dist) * force;
          }
            } else {
          targetX = targetExploded[i3];
          targetY = targetExploded[i3 + 1];
          targetZ = targetExploded[i3 + 2];

          const dx = targetX - x;
          const dy = targetY - y;
          const dz = targetZ - z;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

          if (dist > 0.01) {
            const force = EXPLOSION_STRENGTH;
            velocities[i3] += (dx / dist) * force;
            velocities[i3 + 1] += (dy / dist) * force;
            velocities[i3 + 2] += (dz / dist) * force;
          }

          velocities[i3] += (Math.random() - 0.5) * BROWN_MOTION;
          velocities[i3 + 1] += (Math.random() - 0.5) * BROWN_MOTION;
          velocities[i3 + 2] += (Math.random() - 0.5) * BROWN_MOTION;
        }

        velocities[i3] *= DAMPING;
        velocities[i3 + 1] *= DAMPING;
        velocities[i3 + 2] *= DAMPING;

        positions[i3] += velocities[i3];
        positions[i3 + 1] += velocities[i3 + 1];
        positions[i3 + 2] += velocities[i3 + 2];
      }

        geometry.attributes.position.needsUpdate = true;

      // Star Animation
      if (starRef.current) {
        const isTreeActive = pinchStrengthRef.current > 0.5;
        const targetScale = isTreeActive ? 5 + Math.sin(timeRef.current * 4) * 1.5 : 0;
        gsap.to(starRef.current.scale, {
          x: targetScale,
          y: targetScale,
          duration: 0.5,
          ease: 'power2.out',
        });
      }

      // Trunk Animation
      if (trunkRef.current) {
        const isTreeActive = pinchStrengthRef.current > 0.5;
        trunkRef.current.visible = isTreeActive;
        trunkRef.current.rotation.y += 0.001;
      }

      // Snow Animation
      if (snowParticlesRef.current && snowParticlesRef.current.visible) {
        const snowPos = snowParticlesRef.current.geometry.attributes.position.array as Float32Array;
        const SNOW_COUNT = snowPos.length / 3;
        
        for (let i = 0; i < SNOW_COUNT; i++) {
          const i3 = i * 3;
          snowPos[i3 + 1] -= 0.05 + Math.sin(timeRef.current + i) * 0.02;
          snowPos[i3] += Math.sin(timeRef.current * 0.5 + i) * 0.02;
          
          if (snowPos[i3 + 1] < -15) {
            snowPos[i3 + 1] = 40;
            snowPos[i3] = (Math.random() - 0.5) * 60;
            snowPos[i3 + 2] = (Math.random() - 0.5) * 60;
          }
        }
        snowParticlesRef.current.geometry.attributes.position.needsUpdate = true;
      }

      // Fireworks Animation with enhanced effects
      const activeFireworks = fireworksRef.current.filter(fw => fw.active);
      activeFireworks.forEach(fw => {
        fw.age += 0.016;
        if (fw.age > fw.lifetime) {
          fw.active = false;
          if (fw.particles) {
            scene.remove(fw.particles);
            fw.particles.geometry.dispose();
            (fw.particles.material as THREE.Material).dispose();
          }
          return;
        }
        
        if (fw.particles) {
          const positions = fw.particles.geometry.attributes.position.array as Float32Array;
          const velocities = fw.velocities;
          const colors = fw.particles.geometry.attributes.color.array as Float32Array;
          
          for (let i = 0; i < positions.length / 3; i++) {
            const i3 = i * 3;
            
            // 位置更新
            positions[i3] += velocities[i3];
            positions[i3 + 1] += velocities[i3 + 1];
            positions[i3 + 2] += velocities[i3 + 2];
            
            // 重力效果（增强）
            velocities[i3 + 1] -= 0.015;
            
            // 空气阻力
            velocities[i3] *= 0.97;
            velocities[i3 + 1] *= 0.97;
            velocities[i3 + 2] *= 0.97;
            
            // 颜色渐变到白色（后期变亮效果）
            const ageFactor = fw.age / fw.lifetime;
            if (ageFactor > 0.5) {
              const whiteMix = (ageFactor - 0.5) * 0.6; // 后半段逐渐变白
              colors[i3] = colors[i3] * (1 - whiteMix) + whiteMix;
              colors[i3 + 1] = colors[i3 + 1] * (1 - whiteMix) + whiteMix;
              colors[i3 + 2] = colors[i3 + 2] * (1 - whiteMix) + whiteMix;
            }
          }
          
          fw.particles.geometry.attributes.position.needsUpdate = true;
          fw.particles.geometry.attributes.color.needsUpdate = true;
          
          // 非线性透明度衰减（先亮后快速消失）
          const ageFactor = fw.age / fw.lifetime;
          const opacity = ageFactor < 0.7 ? 1.0 : (1 - (ageFactor - 0.7) / 0.3);
          (fw.particles.material as THREE.PointsMaterial).opacity = opacity;
        }
      });

      // Rotation Control
      const isTreeActive = pinchStrengthRef.current > 0.5;
      
      if (isTreeActive && !isDraggingRef.current) {
        // 自动旋转
        rotationCurrentRef.current.y += 0.005;
      }

      if (treeGroupRef.current) {
        treeGroupRef.current.rotation.x = rotationCurrentRef.current.x;
        treeGroupRef.current.rotation.y = rotationCurrentRef.current.y;
      }

      composer.render();
    };

    animate();

    const handleResize = () => {
      if (!cameraRef.current || !rendererRef.current || !composerRef.current) return;
        cameraRef.current.aspect = window.innerWidth / window.innerHeight;
        cameraRef.current.updateProjectionMatrix();
        rendererRef.current.setSize(window.innerWidth, window.innerHeight);
      composerRef.current.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
        window.removeEventListener('resize', handleResize);
        cancelAnimationFrame(animationFrameId);
        if (rendererRef.current) {
             const domEl = rendererRef.current.domElement;
             if (domEl && domEl.parentNode) domEl.parentNode.removeChild(domEl);
             rendererRef.current.dispose();
             rendererRef.current = null;
        }
      if (composerRef.current) {
        composerRef.current.dispose();
        composerRef.current = null;
        }
        geometry.dispose();
        material.dispose();
        starMaterial.dispose();
      starTexture.dispose();
    };
  }, []); 

  // 2. Mouse and Touch Control
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (isTreeFormed) {
        isDraggingRef.current = true;
        lastMouseRef.current = { x: e.clientX, y: e.clientY };
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingRef.current && isTreeFormed) {
        const deltaX = e.clientX - lastMouseRef.current.x;
        const deltaY = e.clientY - lastMouseRef.current.y;
        
        rotationCurrentRef.current.y += deltaX * 0.01;
        rotationCurrentRef.current.x += deltaY * 0.01;
        
        lastMouseRef.current = { x: e.clientX, y: e.clientY };
      }
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
    };

    // 触摸事件支持（手机端）
    const handleTouchStart = (e: TouchEvent) => {
      if (isTreeFormed && e.touches.length === 1) {
        isDraggingRef.current = true;
        lastMouseRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (isDraggingRef.current && isTreeFormed && e.touches.length === 1) {
        const deltaX = e.touches[0].clientX - lastMouseRef.current.x;
        const deltaY = e.touches[0].clientY - lastMouseRef.current.y;
        
        rotationCurrentRef.current.y += deltaX * 0.01;
        rotationCurrentRef.current.x += deltaY * 0.01;
        
        lastMouseRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    };

    const handleTouchEnd = () => {
      isDraggingRef.current = false;
    };

    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('touchstart', handleTouchStart);
    window.addEventListener('touchmove', handleTouchMove);
    window.addEventListener('touchend', handleTouchEnd);

    return () => {
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isTreeFormed]);

  // 3. Button Handlers
  const toggleTree = () => {
    setIsTreeFormed(!isTreeFormed);
    gsap.to(pinchStrengthRef, {
      current: !isTreeFormed ? 1 : 0,
      duration: 1.5,
      ease: 'power2.inOut',
    });
  };

  const changeTheme = () => {
    const newTheme = (colorThemeRef.current + 1) % 3;
    colorThemeRef.current = newTheme;

    const themeNames = ['经典圣诞', '冰雪奇缘', '梦幻粉紫'];
    setCurrentTheme(themeNames[newTheme]);

    if (particlesRef.current) {
      const colors = particlesRef.current.geometry.attributes.color.array as Float32Array;
      const colorGold = new THREE.Color(0xFFD700);
      const colorWhite = new THREE.Color(0xFFFFFF);
      const colorRed = new THREE.Color(0xFF6B6B);
      const colorGreen = new THREE.Color(0x4ECDC4);
      const colorBlue = new THREE.Color(0x4169E1);
      const colorSilver = new THREE.Color(0xC0C0C0);
      const colorPink = new THREE.Color(0xFF69B4);
      const colorPurple = new THREE.Color(0x9370DB);

      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const i3 = i * 3;
        const rand = Math.random();
        let tempColor = new THREE.Color();

        if (newTheme === 0) {
          if (rand > 0.7) tempColor.copy(colorWhite).multiplyScalar(1.3);
          else if (rand > 0.4) tempColor.copy(colorGold).multiplyScalar(1.5);
          else if (rand > 0.25) tempColor.copy(colorRed).multiplyScalar(1.2);
          else tempColor.copy(colorGreen);
        } else if (newTheme === 1) {
          if (rand > 0.6) tempColor.copy(colorWhite).multiplyScalar(1.4);
          else if (rand > 0.3) tempColor.copy(colorBlue).multiplyScalar(1.5);
          else tempColor.copy(colorSilver).multiplyScalar(1.3);
        } else {
          if (rand > 0.6) tempColor.copy(colorWhite).multiplyScalar(1.4);
          else if (rand > 0.3) tempColor.copy(colorPink).multiplyScalar(1.5);
          else tempColor.copy(colorPurple).multiplyScalar(1.3);
        }

        colors[i3] = tempColor.r;
        colors[i3 + 1] = tempColor.g;
        colors[i3 + 2] = tempColor.b;
      }
      particlesRef.current.geometry.attributes.color.needsUpdate = true;
    }
  };

  const toggleSnow = () => {
    if (!isSnowingRef.current) {
      setIsSnowing(true);
      isSnowingRef.current = true;

      if (snowParticlesRef.current) {
        snowParticlesRef.current.visible = true;
      }

      setTimeout(() => {
        setIsSnowing(false);
        isSnowingRef.current = false;
        if (snowParticlesRef.current) {
          snowParticlesRef.current.visible = false;
        }
      }, 10000);
    }
  };

  const launchFireworks = () => {
    const fireworkPos = {
      x: (Math.random() - 0.5) * 20,
      y: 10 + Math.random() * 10,
      z: 0
    };

    // 移动端减少烟花粒子数
    const mobile = isMobile();
    const layers = [
      { count: mobile ? 60 : 200, speed: 0.8, size: 0.8, delay: 0 },
      { count: mobile ? 45 : 150, speed: 0.5, size: 0.6, delay: 0.1 },
      { count: mobile ? 30 : 100, speed: 0.3, size: 0.4, delay: 0.2 },
    ];

    layers.forEach((layer, layerIndex) => {
      setTimeout(() => {
        const FW_PARTICLES = layer.count;
        const fwGeometry = new THREE.BufferGeometry();
        const fwPositions = new Float32Array(FW_PARTICLES * 3);
        const fwVelocities = new Float32Array(FW_PARTICLES * 3);
        const fwColors = new THREE.Float32Array(FW_PARTICLES * 3);
        const fwSizes = new Float32Array(FW_PARTICLES);

        const fwColor1 = new THREE.Color();
        const fwColor2 = new THREE.Color();
        fwColor1.setHSL(Math.random(), 1.0, 0.6);
        fwColor2.setHSL((Math.random() + 0.3) % 1.0, 1.0, 0.7);

        for (let i = 0; i < FW_PARTICLES; i++) {
          fwPositions[i * 3] = fireworkPos.x;
          fwPositions[i * 3 + 1] = fireworkPos.y;
          fwPositions[i * 3 + 2] = fireworkPos.z;

          const theta = Math.random() * Math.PI * 2;
          const phi = Math.acos(2 * Math.random() - 1);
          const speed = (Math.random() * 0.4 + 0.8) * layer.speed;

          fwVelocities[i * 3] = Math.sin(phi) * Math.cos(theta) * speed;
          fwVelocities[i * 3 + 1] = Math.sin(phi) * Math.sin(theta) * speed;
          fwVelocities[i * 3 + 2] = Math.cos(phi) * speed;

          const colorMix = i / FW_PARTICLES;
          const tempColor = new THREE.Color().lerpColors(fwColor1, fwColor2, colorMix);
          
          fwColors[i * 3] = tempColor.r;
          fwColors[i * 3 + 1] = tempColor.g;
          fwColors[i * 3 + 2] = tempColor.b;
          
          fwSizes[i] = layer.size * (0.8 + Math.random() * 0.4);
        }

        fwGeometry.setAttribute('position', new THREE.BufferAttribute(fwPositions, 3).setUsage(THREE.DynamicDrawUsage));
        fwGeometry.setAttribute('color', new THREE.BufferAttribute(fwColors, 3));
        fwGeometry.setAttribute('size', new THREE.BufferAttribute(fwSizes, 1));

        const fwMaterial = new THREE.PointsMaterial({
          size: layer.size,
          vertexColors: true,
          blending: THREE.AdditiveBlending,
          transparent: true,
          sizeAttenuation: true,
        });

        const fwParticles = new THREE.Points(fwGeometry, fwMaterial);
        sceneRef.current?.add(fwParticles);

        fireworksRef.current.push({
          particles: fwParticles,
          velocities: fwVelocities,
          age: 0,
          lifetime: 3.0,
          active: true,
          layerIndex: layerIndex
        });
      }, layer.delay * 1000);
    });

    if (starRef.current && isTreeFormed) {
      gsap.to(starRef.current.scale, {
        x: 10,
        y: 10,
        duration: 0.2,
        ease: 'power2.out',
        yoyo: true,
        repeat: 1,
      });
    }
  };

  return (
    <div className="relative w-full h-full bg-black">
      <div ref={containerRef} className="absolute inset-0 z-0 overflow-hidden" />

      <div className="absolute top-0 left-0 w-full h-full z-10 pointer-events-none p-3 md:p-6 flex flex-col justify-between">
        <div className="flex justify-between items-start w-full gap-2">
          <div className="bg-black/60 backdrop-blur-md p-2 md:p-4 rounded-lg md:rounded-xl border border-white/10 shadow-xl">
            <h1 className="text-lg md:text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-yellow-200 via-yellow-400 to-yellow-600">
              圣诞树
            </h1>
            <div className="mt-1 md:mt-2 text-xs md:text-sm text-gray-300">
              <div className="flex items-center gap-1 md:gap-2">
                <span className="text-sm md:text-xl">🖱️</span>
                <span className="hidden md:inline">鼠标拖拽旋转圣诞树</span>
                <span className="md:hidden">拖拽旋转</span>
              </div>
              <div className="flex items-center gap-1 md:gap-2 mt-1 text-xs text-gray-400">
                <span>{isMobile() ? '📱' : '💻'}</span>
                <span className="hidden md:inline">粒子数: {PARTICLE_COUNT}</span>
              </div>
            </div>
          </div>

          <div className="px-2 md:px-4 py-1 md:py-2 rounded-full border border-purple-500/30 bg-purple-900/30 backdrop-blur-md font-bold text-xs tracking-wider shadow-lg text-purple-300">
            <span className="hidden md:inline">当前主题: </span>{currentTheme}
          </div>
        </div>

        <div
          className={`
            absolute top-16 md:top-10 left-1/2 transform -translate-x-1/2
            transition-all duration-500 ease-out pointer-events-none
            ${isTreeFormed ? 'scale-110 opacity-100' : 'scale-50 opacity-0'}
          `}
        >
          <div className="text-2xl md:text-6xl font-black text-yellow-100 drop-shadow-[0_0_30px_rgba(255,215,0,0.8)] tracking-tighter mix-blend-screen whitespace-nowrap px-4">
            MERRY CHRISTMAS
          </div>
        </div>

        {/* Control Buttons */}
        <div className="flex flex-col gap-2 md:gap-3 items-center pointer-events-auto w-full px-2 md:px-0">
          <button
            onClick={toggleTree}
            className="w-full md:w-auto px-6 md:px-8 py-3 md:py-4 bg-gradient-to-r from-green-600 to-green-700 active:from-green-500 active:to-green-600 text-white font-bold text-base md:text-lg rounded-lg md:rounded-xl shadow-2xl border border-green-400/30 transition-all active:scale-95 touch-manipulation"
          >
            {isTreeFormed ? '💥 散开' : '🎄 凝聚圣诞树'}
          </button>
          
          <div className="grid grid-cols-3 gap-2 w-full md:flex md:gap-3 md:w-auto">
            <button
              onClick={changeTheme}
              disabled={!isTreeFormed}
              className="px-2 py-3 md:px-6 md:py-3 bg-gradient-to-r from-purple-600 to-pink-600 active:from-purple-500 active:to-pink-500 disabled:from-gray-600 disabled:to-gray-700 disabled:opacity-50 text-white font-bold text-sm md:text-base rounded-lg md:rounded-xl shadow-xl border border-purple-400/30 transition-all active:scale-95 touch-manipulation flex flex-col md:flex-row items-center justify-center gap-1"
            >
              <span className="text-xl md:text-base">🎨</span>
              <span className="text-xs md:text-base md:hidden">颜色</span>
              <span className="hidden md:inline">切换颜色</span>
            </button>
            
            <button
              onClick={toggleSnow}
              disabled={!isTreeFormed || isSnowing}
              className="px-2 py-3 md:px-6 md:py-3 bg-gradient-to-r from-blue-600 to-cyan-600 active:from-blue-500 active:to-cyan-500 disabled:from-gray-600 disabled:to-gray-700 disabled:opacity-50 text-white font-bold text-sm md:text-base rounded-lg md:rounded-xl shadow-xl border border-blue-400/30 transition-all active:scale-95 touch-manipulation flex flex-col md:flex-row items-center justify-center gap-1"
            >
              <span className="text-xl md:text-base">❄️</span>
              <span className="text-xs md:text-base md:hidden">飘雪</span>
              <span className="hidden md:inline">飘雪</span>
            </button>
            
            <button
              onClick={launchFireworks}
              disabled={!isTreeFormed}
              className="px-2 py-3 md:px-6 md:py-3 bg-gradient-to-r from-yellow-600 to-orange-600 active:from-yellow-500 active:to-orange-500 disabled:from-gray-600 disabled:to-gray-700 disabled:opacity-50 text-white font-bold text-sm md:text-base rounded-lg md:rounded-xl shadow-xl border border-yellow-400/30 transition-all active:scale-95 touch-manipulation flex flex-col md:flex-row items-center justify-center gap-1"
            >
              <span className="text-xl md:text-base">🎆</span>
              <span className="text-xs md:text-base md:hidden">烟花</span>
              <span className="hidden md:inline">烟花</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GestureTree;
