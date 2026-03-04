<template>
  <div id="mapComponent" class="map-component">
    <div class="map-wrapper">
      <!-- 地图信息显示，暂时隐藏 -->
      <div v-if="false" ref="mapInfo" class="map-info">
        缩放: <span>{{ mapState.zoom.toFixed(1) }}</span>
        x | 坐标:
        <span id="coords"
          >{{ Math.round(-mapState.offsetX / mapState.zoom) }},
          {{ Math.round(-mapState.offsetY / mapState.zoom) }}
        </span>
      </div>

      <div class="map-operate">
        <div title="回到玩家位置" @click="resetToPlayer">🎯</div>
        <div @click="zoomIn">+</div>
        <div @click="zoomOut">-</div>
      </div>

      <div id="mapContainer" class="map-container">
        <canvas id="mapCanvas"></canvas>

        <!-- 动态生成marker -->
        <div
          v-for="(marker, index) in markers"
          :key="index"
          class="marker location-marker"
          :class="{ 'marker-highlighted': selectedMarker?.name === marker.name }"
          :style="{
            left: marker.pos!.x * mapState.zoom + mapState.offsetX + 'px',
            top: marker.pos!.y * mapState.zoom + mapState.offsetY + 'px',
            transform: `translate(-50%, -50%)`,
          }"
          @click="selectLocation(marker)"
          @touchstart="handleMarkerTouchStart(marker, $event)"
          @mouseenter="hoverMarker = marker.name"
          @mouseleave="hoverMarker = null"
          v-html="marker.htmlEle ?? marker.name"
        ></div>

        <div
          v-for="(region, index) in regions"
          :key="index"
          class="marker location-marker region-marker"
          :style="{
            left: region.pos.x * mapState.zoom + mapState.offsetX + 'px',
            top: region.pos.y * mapState.zoom + mapState.offsetY + 'px',
            transform: `translate(-50%, -50%)`,
          }"
          @click="zoomToRegion(region)"
          @touchstart="zoomToRegion(region)"
          v-html="region.htmlEle ?? region.name"
        ></div>

        <!-- 点击marker的tip弹出 -->
        <div
          v-if="selectedMarker"
          class="tip-container"
          :class="{ 'tip-visible': selectedMarker }"
          :style="{
            left: selectedMarker.pos!.x * mapState.zoom + mapState.offsetX + 'px',
            top: selectedMarker.pos!.y * mapState.zoom + mapState.offsetY - 20 + 'px',
            transform: `translate(-50%, -100%)`,
          }"
        >
          <div class="dialog">
            <div class="dialog-header">
              <h2 class="location-name">{{ selectedMarker.name }}</h2>
              <button class="close-btn" @click="selectedMarker = null" @touchstart="selectedMarker = null">×</button>
            </div>
            <div class="dialog-content">
              <div v-if="charactersInSelectedLocation.length > 0" class="npc-list">
                <div
                  v-for="npc in charactersInSelectedLocation"
                  :key="npc.id"
                  class="npc-item"
                  @click="openRoleDetailPopup(npc)"
                  @touchstart="handleNpcTouch(npc, $event)"
                >
                  <span class="npc-name">{{ npc.name }}：</span>
                  <span class="npc-target">{{ npc['目标'] || '未知' }}</span>
                </div>
              </div>
              <div v-else class="empty-location">空无一人</div>
            </div>
          </div>
        </div>

        <!-- 玩家 -->
        <div
          v-if="playerMarker"
          class="marker player-marker pulsate"
          :style="{
            left: playerMarker.pos!.x * mapState.zoom + mapState.offsetX + 'px',
            top: playerMarker.pos!.y * mapState.zoom + mapState.offsetY + 'px',
            transform: `translate(-50%, -100%)`,
          }"
          v-html="playerMarker.htmlEle"
        ></div>
      </div>
    </div>
    <RoleDetailPopup
      v-if="showRoleDetailPopup"
      :character="selectedCharacterForPopup"
      :stat-without-meta="props.context.statWithoutMeta"
      :runtime="props.context.runtime"
      @close="showRoleDetailPopup = false"
    />
  </div>
</template>

<script setup lang="ts">
import RoleDetailPopup from '../common/RoleDetailPopup/RoleDetailPopup.vue';
import { MapMarker, MapState, Road } from './Map';
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { getRegions, FlatLocation, calculateMaxDifference } from './mapUtil';

const zoomRange = {
  max: 5,
  min: 0.2,
  baseLocationZoom: 2.2,
};

// 定义 props
const props = defineProps({
  context: null,
});

// 检测是否为移动设备
const isMobile = ref(false);
const checkIfMobile = () => {
  isMobile.value = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
};

// 地图尺寸
const mapSize = computed(() => {
  if (props.context?.runtime?.area?.mapSize) {
    const padding = 20; // 留些padding
    return {
      width: props.context.runtime.area.mapSize.width + padding,
      height: props.context.runtime.area.mapSize.height + padding,
    };
  }

  return {
    width: 800,
    height: 600,
  };
});

const allShowLocations: ComputedRef<{ showRegions: FlatLocation[]; showLocation: FlatLocation[] }> = computed(() => {
  if (props.context?.statWithoutMeta?.world?.map_graph?.tree) {
    const { regions, baseLocation } = getRegions(props.context.statWithoutMeta.world.map_graph.tree);

    // 什么缩放等级显示多少level的区域
    let level = 0;
    if (mapState.value.zoom >= zoomRange.baseLocationZoom) {
      level = 0;
    } else if (mapState.value.zoom >= 1.2) {
      level = 1;
    } else if (mapState.value.zoom >= 0.3) {
      level = 2;
    } else {
      level = 3;
    }

    const showRegionMap = new Map<string, boolean>();
    const levelFilterRegions = regions.filter(item => item.level <= level);
    levelFilterRegions.forEach(item => {
      showRegionMap.set(item.name, true);
    });

    const showRegions: FlatLocation[] = [];
    levelFilterRegions.forEach(item => {
      // 不存在更上级的区域，或者上级区域不显示的，才能最终显示
      if (!item.father || !showRegionMap.get(item.father)) {
        showRegions.push(item);
      }
    });

    const showLocation: FlatLocation[] = [];
    baseLocation.forEach(item => {
      // 不存在更上级的区域，或者上级区域不显示的，才能最终显示
      if (!item.father || !showRegionMap.get(item.father)) {
        showLocation.push(item);
      }
    });

    return { showRegions, showLocation };
  }

  return { showRegions: [], showLocation: [] };
});

const regions: ComputedRef<FlatLocation[]> = computed(() => {
  if (allShowLocations.value) {
    return allShowLocations.value.showRegions;
  }

  return [];
});

// 地图上的地点
const markers: ComputedRef<MapMarker[]> = computed(() => {
  if (allShowLocations.value) {
    return allShowLocations.value.showLocation;
  }

  return [];
});

// 地图上的道路
const roads: ComputedRef<Road[]> = computed(() => {
  const result: Road[] = [];
  if (props.context?.runtime?.area?.graph) {
    // 创建子地点到父地点的映射
    const childToParentMap = new Map<string, FlatLocation>();

    // 遍历所有地点，建立子地点到父地点的映射
    [...allShowLocations.value.showLocation, ...allShowLocations.value.showRegions].forEach(location => {
      if (location.children?.length) {
        location.children.forEach(child => {
          childToParentMap.set(child.name, location);
        });
      } else {
        childToParentMap.set(location.name, location);
      }
    });

    // 处理每个子地点连接
    Object.entries(props.context.runtime.area.graph).forEach(([fromChild, toChildren]) => {
      Object.keys(toChildren as any).forEach(toChild => {
        const fromParent = childToParentMap.get(fromChild);
        const toParent = childToParentMap.get(toChild);

        if (fromParent && toParent) {
          result.push({
            start: fromParent.pos,
            end: toParent.pos,
          });
        }
      });
    });
  }

  return result;
});

// 玩家的marker
const playerMarker: ComputedRef<MapMarker | null> = computed(() => {
  if (props.context?.runtime?.characterDistribution?.playerLocation) {
    const playerMarkerData = {
      name: '玩家',
      htmlEle: '<div class="player-icon">📍</div>',
    };
    const playerLocation = props.context.runtime.characterDistribution.playerLocation;

    const location = allShowLocations.value.showLocation.find(location => location.name === playerLocation);
    if (location) {
      return {
        pos: location.pos,
        ...playerMarkerData,
      };
    }

    const findRegion = allShowLocations.value.showRegions.find(region =>
      region.children.find(child => child.name === playerLocation),
    );
    if (findRegion) {
      return {
        pos: findRegion.pos,
        ...playerMarkerData,
      };
    }
  }

  return null;
});

const mapState = ref<MapState>({
  offsetX: 0,
  offsetY: 0,
  zoom: 1,
  isDragging: false,
  lastMouseX: 0,
  lastMouseY: 0,
  mapWidth: 300,
  mapHeight: 300,
  // 添加触摸相关状态
  isTouching: false,
  lastTouchDistance: 0,
  initialTouches: [],
});

const selectedMarker = ref<MapMarker | null>(null);
const hoverMarker = ref<string | null>(null);
const charactersInSelectedLocation = ref<any[]>([]);
const showRoleDetailPopup = ref(false);
const selectedCharacterForPopup = ref<any | null>(null);
let mapComponent: HTMLElement;
let mapContainer: HTMLElement;
let canvas: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;

// 触摸相关变量
let touchStartTime = 0;
let longPressTimer: number | null = null;

function openRoleDetailPopup(character: any) {
  selectedCharacterForPopup.value = character;
  showRoleDetailPopup.value = true;
}

function closeLocationPopup() {
  // 关闭弹出窗
  selectedMarker.value = null;
}

function selectLocation(markerData: MapMarker) {
  // 点击相同地点关闭弹出
  if (markerData.name === selectedMarker.value?.name) {
    selectedMarker.value = null;
    charactersInSelectedLocation.value = [];
    return;
  }

  const npcIdList = props.context?.runtime?.characterDistribution?.npcByLocation?.[markerData.name];
  if (npcIdList) {
    charactersInSelectedLocation.value = npcIdList.map((id: string) => {
      return { ...props.context.statWithoutMeta.chars[id], id };
    });
  } else {
    charactersInSelectedLocation.value = [];
  }

  selectedMarker.value = { ...markerData, htmlEle: '' }; // htmlEle is no longer needed
}

// 处理标记触摸开始
function handleMarkerTouchStart(markerData: MapMarker, event: TouchEvent) {
  event.preventDefault();
  event.stopPropagation();

  touchStartTime = Date.now();

  // 设置长按定时器
  longPressTimer = window.setTimeout(() => {
    // 长按处理，可以在这里添加长按功能
    console.log('长按标记:', markerData.name);
  }, 500);

  // 直接触发选择，因为移动端点击和触摸很难区分
  selectLocation(markerData);
}

function zoomToRegion(region: FlatLocation) {
  const containerWidth = mapContainer.clientWidth;
  const containerHeight = mapContainer.clientHeight;
  const padding = 20;
  const { diffX, diffY } = calculateMaxDifference(region.children);
  let zoom = Math.max((containerWidth - padding) / diffX, (containerHeight - padding) / diffY);
  zoom = Math.max(zoom, zoomRange.min);
  zoom = Math.min(zoom, zoomRange.max);
  zoom = Math.max(zoomRange.baseLocationZoom, zoom);

  mapState.value = {
    ...mapState.value,
    zoom,
    offsetX: containerWidth / 2 - region.pos!.x * zoom,
    offsetY: containerHeight / 2 - region.pos!.y * zoom,
  };

  drawMap();
}

// 处理NPC触摸
function handleNpcTouch(npc: any, event: TouchEvent) {
  event.preventDefault();
  event.stopPropagation();
  openRoleDetailPopup(npc);
}

// 在 script 部分添加重置到玩家位置的函数
function resetToPlayer() {
  if (playerMarker.value) {
    // 先设置zoom。让playerPos重新计算
    mapState.value = {
      ...mapState.value,
      zoom: zoomRange.max,
    };

    setTimeout(() => {
      const playerPos = playerMarker.value!.pos;
      const containerWidth = mapContainer.clientWidth;
      const containerHeight = mapContainer.clientHeight;

      console.log('playerPos2===', playerPos);
      mapState.value = {
        ...mapState.value,
        zoom: zoomRange.max,
        offsetX: containerWidth / 2 - playerPos!.x * zoomRange.max,
        offsetY: containerHeight / 2 - playerPos!.y * zoomRange.max,
      };

      drawMap();
    }, 100);
  }
}

// 缩放控制
function zoomIn() {
  closeLocationPopup();

  const zoomFactor = 1.2;
  const newZoom = mapState.value.zoom * zoomFactor;

  if (newZoom <= 5) {
    const containerWidth = mapContainer.clientWidth;
    const containerHeight = mapContainer.clientHeight;

    mapState.value = {
      ...mapState.value,
      zoom: newZoom,
      offsetX: containerWidth / 2 - (containerWidth / 2 - mapState.value.offsetX) * zoomFactor,
      offsetY: containerHeight / 2 - (containerHeight / 2 - mapState.value.offsetY) * zoomFactor,
    };

    drawMap();
  }
}

function zoomOut() {
  closeLocationPopup();

  const zoomFactor = 0.8;
  const newZoom = mapState.value.zoom * zoomFactor;

  if (newZoom >= 0.2) {
    const containerWidth = mapContainer.clientWidth;
    const containerHeight = mapContainer.clientHeight;

    mapState.value = {
      ...mapState.value,
      zoom: newZoom,
      offsetX: containerWidth / 2 - (containerWidth / 2 - mapState.value.offsetX) * zoomFactor,
      offsetY: containerHeight / 2 - (containerHeight / 2 - mapState.value.offsetY) * zoomFactor,
    };

    drawMap();
  }
}

// 重置视图
function resetView() {
  mapState.value = {
    ...mapState.value,
    zoom: 1,
    offsetX: (mapContainer.clientWidth - mapState.value.mapWidth) / 2,
    offsetY: (mapContainer.clientHeight - mapState.value.mapHeight) / 2,
  };

  drawMap();
}

// 绘制地图
function drawMap() {
  // 清除画布
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 保存当前状态
  ctx.save();

  // 应用变换（缩放和平移）
  ctx.translate(mapState.value.offsetX, mapState.value.offsetY);
  ctx.scale(mapState.value.zoom, mapState.value.zoom);

  // 绘制地图背景和道路
  drawMapBackground();
  drawRoads();

  // 恢复状态
  ctx.restore();
}

// 绘制地图背景
function drawMapBackground() {
  // 创建渐变背景
  const gradient = ctx.createLinearGradient(0, 0, mapSize.value.width, mapSize.value.height);
  gradient.addColorStop(0, '#8e9eab');
  gradient.addColorStop(1, '#eef2f3');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, mapSize.value.width, mapSize.value.height);

  // 添加网格线
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = 1;
  const gridSize = 50;

  for (let x = 0; x <= mapSize.value.width; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, mapSize.value.height);
    ctx.stroke();
  }

  for (let y = 0; y <= mapSize.value.height; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(mapSize.value.width, y);
    ctx.stroke();
  }
}

// 绘制道路
function drawRoads() {
  try {
    roads.value.forEach(road => {
      // 绘制道路阴影
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
      ctx.lineWidth = 8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(road.start.x + 2, road.start.y + 2);
      ctx.lineTo(road.end.x + 2, road.end.y + 2);
      ctx.stroke();

      // 绘制主要道路
      const gradient = ctx.createLinearGradient(road.start.x, road.start.y, road.end.x, road.end.y);
      gradient.addColorStop(0, '#5d4037');
      gradient.addColorStop(0.5, '#6d4c41');
      gradient.addColorStop(1, '#5d4037');

      ctx.strokeStyle = gradient;
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(road.start.x, road.start.y);
      ctx.lineTo(road.end.x, road.end.y);
      ctx.stroke();

      // 绘制道路中心线（如果是主要道路）
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 3]);
      ctx.beginPath();
      ctx.moveTo(road.start.x, road.start.y);
      ctx.lineTo(road.end.x, road.end.y);
      ctx.stroke();
      ctx.setLineDash([]);
    });
  } catch (error) {
    console.error('道路数据格式错误:', error);
  }
}

// 计算两点之间的距离
function getDistance(touch1: Touch, touch2: Touch): number {
  const dx = touch1.clientX - touch2.clientX;
  const dy = touch1.clientY - touch2.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

// 计算两点的中心点
function getMidpoint(touch1: Touch, touch2: Touch): { x: number; y: number } {
  return {
    x: (touch1.clientX + touch2.clientX) / 2,
    y: (touch1.clientY + touch2.clientY) / 2,
  };
}

// 更新canvas尺寸
function updateCanvasSize() {
  const containerWidth = mapContainer.clientWidth;
  const containerHeight = containerWidth; // 高度与宽度一致，形成正方形
  mapContainer.style.height = `${containerHeight}px`;
  mapComponent.style.height = `${containerHeight}px`;

  mapState.value.mapWidth = containerWidth;
  mapState.value.mapHeight = containerHeight;
  canvas.width = containerWidth;
  canvas.height = containerHeight;

  drawMap();
}

function handleTouchStart(e: TouchEvent) {
  e.preventDefault();

  if (e.touches.length === 1) {
    // 单指触摸 - 准备拖动
    mapState.value = {
      ...mapState.value,
      isTouching: true,
      lastMouseX: e.touches[0].clientX,
      lastMouseY: e.touches[0].clientY,
    };
  } else if (e.touches.length === 2) {
    // 双指触摸 - 准备缩放
    mapState.value = {
      ...mapState.value,
      isTouching: true,
      lastTouchDistance: getDistance(e.touches[0], e.touches[1]),
      initialTouches: [e.touches[0], e.touches[1]],
    };
  }
}

function handleTouchMove(e: TouchEvent) {
  e.preventDefault();

  if (!mapState.value.isTouching) return;

  if (e.touches.length === 1 && !mapState.value.lastTouchDistance) {
    // 单指移动 - 拖动地图
    const deltaX = e.touches[0].clientX - mapState.value.lastMouseX;
    const deltaY = e.touches[0].clientY - mapState.value.lastMouseY;

    mapState.value.offsetX += deltaX;
    mapState.value.offsetY += deltaY;

    mapState.value.lastMouseX = e.touches[0].clientX;
    mapState.value.lastMouseY = e.touches[0].clientY;

    drawMap();
  } else if (e.touches.length === 2) {
    // 双指移动 - 缩放地图
    const currentDistance = getDistance(e.touches[0], e.touches[1]);

    if (mapState.value.lastTouchDistance > 0) {
      const zoomFactor = currentDistance / mapState.value.lastTouchDistance;
      const newZoom = mapState.value.zoom * zoomFactor;

      // 限制缩放范围
      if (newZoom >= zoomRange.min && newZoom <= zoomRange.max) {
        // 计算缩放中心点
        const midpoint = getMidpoint(e.touches[0], e.touches[1]);
        const rect = mapContainer.getBoundingClientRect();
        const touchX = midpoint.x - rect.left;
        const touchY = midpoint.y - rect.top;

        // 计算触摸点在画布上的位置（考虑当前变换）
        const worldX = (touchX - mapState.value.offsetX) / mapState.value.zoom;
        const worldY = (touchY - mapState.value.offsetY) / mapState.value.zoom;

        mapState.value = {
          ...mapState.value,
          zoom: newZoom,
          // 调整偏移量，使缩放以触摸位置为中心
          offsetX: touchX - worldX * mapState.value.zoom,
          offsetY: touchY - worldY * mapState.value.zoom,
        };

        drawMap();
      }
    }

    mapState.value.lastTouchDistance = currentDistance;
  }
}

function handleTouchEnd(e: TouchEvent) {
  // 清除长按定时器
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }

  mapState.value = {
    ...mapState.value,
    isTouching: false,
    lastTouchDistance: 0,
    initialTouches: [],
  };
}

onMounted(() => {
  // 检测是否为移动设备
  checkIfMobile();

  // 获取DOM元素
  mapComponent = document.getElementById('mapComponent') as HTMLElement;
  mapContainer = document.getElementById('mapContainer') as HTMLElement;
  canvas = document.getElementById('mapCanvas') as HTMLCanvasElement;
  ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

  // 设置初始尺寸
  updateCanvasSize();

  // 生成地图
  function generateMap() {
    // 重置视图
    resetToPlayer();

    // 绘制地图背景和道路
    drawMap();
  }

  // 事件处理：鼠标按下开始拖动
  mapContainer.addEventListener('mousedown', e => {
    mapState.value = {
      ...mapState.value,
      isDragging: true,
      lastMouseX: e.clientX,
      lastMouseY: e.clientY,
    };

    mapContainer.style.cursor = 'grabbing';
  });

  // 事件处理：鼠标移动拖动地图
  mapContainer.addEventListener('mousemove', e => {
    if (mapState.value.isDragging) {
      const deltaX = e.clientX - mapState.value.lastMouseX;
      const deltaY = e.clientY - mapState.value.lastMouseY;

      mapState.value.offsetX += deltaX;
      mapState.value.offsetY += deltaY;

      mapState.value.lastMouseX = e.clientX;
      mapState.value.lastMouseY = e.clientY;

      drawMap();
    }
  });

  // 事件处理：鼠标释放停止拖动
  mapContainer.addEventListener('mouseup', () => {
    mapState.value.isDragging = false;
    mapContainer.style.cursor = 'grab';
  });

  mapContainer.addEventListener('mouseleave', () => {
    mapState.value.isDragging = false;
    mapContainer.style.cursor = 'grab';
  });

  // 事件处理：鼠标滚轮缩放
  mapContainer.addEventListener('wheel', e => {
    e.preventDefault();
    closeLocationPopup();

    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = mapState.value.zoom * zoomFactor;

    // 限制缩放范围
    if (newZoom >= zoomRange.min && newZoom <= zoomRange.max) {
      // 获取容器位置和尺寸
      const rect = mapContainer.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // 计算鼠标在画布上的世界坐标（考虑当前变换）
      const worldX = (mouseX - mapState.value.offsetX) / mapState.value.zoom;
      const worldY = (mouseY - mapState.value.offsetY) / mapState.value.zoom;

      // 计算新的偏移量，使缩放以鼠标位置为中心
      const newOffsetX = mouseX - worldX * newZoom;
      const newOffsetY = mouseY - worldY * newZoom;

      mapState.value = {
        ...mapState.value,
        zoom: newZoom,
        offsetX: newOffsetX,
        offsetY: newOffsetY,
      };

      drawMap();
    }
  });

  // 触摸事件处理
  mapContainer.addEventListener('touchstart', handleTouchStart, { passive: false });
  mapContainer.addEventListener('touchmove', handleTouchMove, { passive: false });
  mapContainer.addEventListener('touchend', handleTouchEnd);
  mapContainer.addEventListener('touchcancel', handleTouchEnd);

  // 初始生成地图
  generateMap();
});

onUnmounted(() => {
  // 清理事件监听器
  if (mapContainer) {
    mapContainer.removeEventListener('touchstart', handleTouchStart);
    mapContainer.removeEventListener('touchmove', handleTouchMove);
    mapContainer.removeEventListener('touchend', handleTouchEnd);
    mapContainer.removeEventListener('touchcancel', handleTouchEnd);
  }
});
</script>

<style lang="scss">
.map-component {
  background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
  overflow: hidden;
  margin-bottom: 20px;
  border-radius: 12px;
  /* 防止移动端浏览器默认行为 */
  touch-action: none;
  -webkit-user-select: none;
  user-select: none;

  .map-wrapper {
    position: relative;
    width: 100%;
    height: 100%;
    background: #f0f0f0;
    border-radius: 12px;
  }

  .map-container {
    white-space: nowrap;
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
    cursor: grab;
    border-radius: 12px;
    /* 优化移动端触摸体验 */
    -webkit-tap-highlight-color: transparent;
    -webkit-touch-callout: none;
  }

  svg {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;

    path {
      fill: rgba(160, 0, 0, 0.2);
    }
  }

  #mapCanvas {
    display: block;
    border-radius: 12px;
  }

  .marker {
    position: absolute;
    transform: translate(-50%, -50%);
    cursor: pointer;
    z-index: 10;
    user-select: none;
    /* 优化移动端触摸体验 */
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
  }

  .location-marker {
    font-size: 14px;
    background: var(--bg);
    border-radius: 8px;
    padding: 6px 10px;
    box-shadow:
      0 2px 8px rgba(0, 0, 0, 0.15),
      inset 0 1px 0 rgba(255, 255, 255, 0.8);
    border: 1px solid rgba(255, 255, 255, 0.5);
    min-width: 60px;
    text-align: center;
    font-weight: 500;
    color: var(--ink);

    /* 移动端适配 */
    @media (max-width: 768px) {
      font-size: 12px;
      padding: 5px 8px;
      min-width: 50px;
    }

    &:hover {
      background: linear-gradient(145deg, #4fc3f7, #29b6f6);
      color: white;
      box-shadow: 0 4px 16px rgba(41, 182, 246, 0.4);
    }

    /* 移动端激活状态 */
    &:active {
      background: linear-gradient(145deg, #4fc3f7, #29b6f6);
      color: white;
      transform: translate(-50%, -50%) scale(0.95);
    }
  }

  .region-marker {
    border-radius: 50%;
    padding: 10px;
    min-width: 60px;
  }

  .marker-highlighted {
    background: linear-gradient(145deg, #ff9800, #f57c00) !important;
    color: white !important;
    box-shadow: 0 4px 20px rgba(255, 152, 0, 0.6) !important;
    z-index: 20 !important;

    &::before {
      border-top-color: #ff9800 !important;
    }
  }

  .player-marker {
    background: none !important;
    border: none !important;
    box-shadow: none !important;
    font-size: 24px;
    z-index: 25;
    filter: drop-shadow(0 2px 8px rgba(255, 235, 59, 0.6));
    cursor: default;

    .player-icon {
      display: block;
      animation: float 3s ease-in-out infinite;
    }
  }

  .map-info {
    position: absolute;
    top: 20px;
    left: 20px;
    background: rgba(255, 255, 255, 0.95);
    padding: 8px 16px;
    border-radius: 8px;
    font-size: 0.9rem;
    z-index: 40;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    border: 1px solid rgba(0, 0, 0, 0.1);
  }

  .map-operate {
    position: absolute;
    top: 20px;
    right: 20px;
    z-index: 40;
    display: flex;
    gap: 10px;
    flex-direction: column;

    > div {
      background: rgba(255, 255, 255, 0.95);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      border: 1px solid rgba(0, 0, 0, 0.1);
      padding: 8px;
      border-radius: 8px;
      cursor: pointer;
      text-align: center;
      font-size: 20px;

      /* 移动端适配 */
      @media (max-width: 768px) {
        font-size: 16px;
      }
    }
  }

  @keyframes bounce {
    0%,
    20%,
    50%,
    80%,
    100% {
      transform: translate(-50%, -100%);
    }

    40% {
      transform: translate(-50%, calc(-100% - 30px));
    }

    60% {
      transform: translate(-50%, calc(-100% - 15px));
    }
  }

  @keyframes float {
    0%,
    100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-8px);
    }
  }

  .pulsate {
    animation: bounce 2s infinite;
  }

  .tip-container {
    position: absolute;
    transform-origin: bottom center;
    z-index: 30;
    opacity: 0;

    &.tip-visible {
      opacity: 1;
      animation: tipAppear 0.3s ease;
    }
  }

  @keyframes tipAppear {
    from {
      opacity: 0;
      transform: translate(-50%, -80%) scale(0.8);
    }
    to {
      opacity: 1;
      transform: translate(-50%, -100%) scale(1);
    }
  }

  .dialog {
    border-radius: 12px;
    padding: 0;
    box-shadow:
      0 8px 32px rgba(0, 0, 0, 0.2),
      0 2px 8px rgba(0, 0, 0, 0.1);
    color: var(--ink);
    background: linear-gradient(145deg, #ffffff, #f8f9fa);
    position: relative;
    border: 1px solid rgba(255, 255, 255, 0.8);
    min-width: 200px;
    backdrop-filter: blur(10px);

    /* 移动端适配 */
    @media (max-width: 768px) {
      min-width: 180px;
      max-width: 90vw;
    }

    .dialog-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 20px;
      border-bottom: 1px solid rgba(0, 0, 0, 0.1);
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border-radius: 12px 12px 0 0;
      color: white;

      .location-name {
        font-size: 18px;
        font-weight: 600;
        margin: 0;
        color: white;

        /* 移动端适配 */
        @media (max-width: 768px) {
          font-size: 16px;
        }
      }

      .close-btn {
        background: rgba(255, 255, 255, 0.2);
        border: none;
        color: white;
        width: 24px;
        height: 24px;
        border-radius: 50%;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 16px;
        transition: background 0.2s ease;

        &:hover {
          background: rgba(255, 255, 255, 0.3);
        }

        /* 移动端适配 */
        @media (max-width: 768px) {
          width: 28px;
          height: 28px;
          font-size: 18px;
        }
      }
    }

    .dialog-content {
      padding: 20px;

      .npc-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .npc-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 12px;
        background: rgba(0, 0, 0, 0.03);
        border-radius: 6px;
        transition: background 0.2s ease;
        cursor: pointer;
        /* 优化移动端触摸体验 */
        -webkit-tap-highlight-color: transparent;

        &:hover {
          background: rgba(0, 0, 0, 0.06);
        }

        /* 移动端激活状态 */
        &:active {
          background: rgba(0, 0, 0, 0.1);
        }

        /* 移动端适配 */
        @media (max-width: 768px) {
          padding: 10px 12px;
          flex-direction: column;
          align-items: flex-start;
          gap: 4px;
        }
      }

      .npc-name {
        font-weight: 500;
        color: #2c3e50;
      }

      .npc-target {
        color: #7f8c8d;
        font-size: 0.9em;
      }

      .empty-location {
        text-align: center;
        color: #95a5a6;
        font-style: italic;
        padding: 20px;
      }
    }
  }

  .dialog::after {
    content: '';
    position: absolute;
    top: 100%;
    left: 50%;
    transform: translateX(-50%);
    border: 12px solid transparent;
    border-top-color: #fff;
    filter: drop-shadow(0 2px 2px rgba(0, 0, 0, 0.1));
  }

  /* 移动端特定样式 */
  @media (max-width: 768px) {
    .map-operate {
      top: 10px;
      right: 10px;
      padding: 6px 12px;
      font-size: 14px;
    }

    .map-info {
      top: 10px;
      left: 10px;
      padding: 6px 12px;
      font-size: 0.8rem;
    }
  }
}
</style>
