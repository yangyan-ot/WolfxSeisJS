const wsUrl = 'wss://seisjs.wolfx.jp/all_seis';
let socket;
let reconnectInterval = 1000; // 1秒重连间隔
let seismicStations = []; // 存储地震测站数据的数组
let lastUpdateTimes = {}; // 记录每个测站的最后更新时间
let map; // 全局变量，存储地图对象
let customLayer; // 全局变量，存储自定义图层
let defaultZoom = 4.5; // 默认缩放级别
let defaultCenter = [104.3046875, 36.20882309283712]; // 默认中心位置
let currentZoom = defaultZoom; // 当前缩放级别
let currentCenter = defaultCenter; // 当前中心位置
let timeoutId; // 定时器ID
let isTimerSet = false; // 标志变量，用于跟踪是否已经设置了定时器
let zoomedToStation = false; // 标志变量，表示地图是否已经缩放到某个特定测站

// 初始化地图（添加设备像素比设置）
function initMap() {
  AMap.plugin(['AMap.CustomLayer'], function() {
    map = new AMap.Map('container', {
      zoom: defaultZoom,
      center: defaultCenter,
      mapStyle: 'amap://styles/whitesmoke'
    });

    addCustomLayer();

    // 修改事件监听逻辑
    map.on('movestart', function() {
      clearTimeout(timeoutId);
      isTimerSet = false;
      zoomedToStation = false;
    });

    map.on('moveend', function() {
      customLayer.render();
    });

    let renderTimeout;
    map.on('move', function() {
      clearTimeout(renderTimeout);
      renderTimeout = setTimeout(() => customLayer.render(), 50);
    });

    window.addEventListener('resize', function() {
      customLayer.render();
      adjustStationListHeight();
    });
    document.getElementById('reset-button').addEventListener('click', resetView);
  });
}

// 颜色插值函数
function interpolateColor(c1, c2, factor) {
  function hexToRgb(hex) {
    let bigint = parseInt(hex.replace('#', ''), 16);
    let r = (bigint >> 16) & 255;
    let g = (bigint >> 8) & 255;
    let b = bigint & 255;
    return [r, g, b];
  }

  function rgbToHex(rgb) {
    return "#" + ((1 << 24) + (rgb[0] << 16) + (rgb[1] << 8) + rgb[2]).toString(16).slice(1).toUpperCase();
  }

  let rgb1 = hexToRgb(c1);
  let rgb2 = hexToRgb(c2);

  let resultRgb = rgb1.map((c, i) => Math.round(c + factor * (rgb2[i] - c)));

  return rgbToHex(resultRgb);
}

// 修改后的震度颜色函数，支持插值
function getColorForCalcShindo(calcShindo) {
  const colors = [
    "#020dc9", "#0042f6", "#00d493", "#35da32", "#b4f70c", "#fcff00", "#dbc500", "#ff9600", "#ff4a00", "#f80200", "#0004d2"
  ];

  // 确保 calcShindo 的值在有效范围内
  calcShindo = Math.min(Math.max(calcShindo, -3), colors.length - 4);

  // 找到两个相邻的颜色进行插值
  let index = Math.floor(calcShindo) + 3;
  let nextIndex = index + 1;

  // 如果是最后一个颜色，则直接返回该颜色，不进行插值
  if (index >= colors.length - 1) {
    return colors[colors.length - 1];
  }

  // 计算两个相邻颜色之间的插值因子
  let factor = calcShindo - (index - 3);

  // 返回插值后的颜色
  return interpolateColor(colors[index], colors[nextIndex], factor);
}

// 修改后的自定义图层
function addCustomLayer() {
  const canvas = document.createElement('canvas');
  canvas.willReadFrequently = true;
  customLayer = new AMap.CustomLayer(canvas, {
    zooms: [0, 20],
    zIndex: 120
  });

  const onRender = function() {
    const retina = AMap.Browser.retina ? 2 : 1;
    const size = map.getSize();
    let width = size.width * retina;
    let height = size.height * retina;
    
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = size.width + 'px';
    canvas.style.height = size.height + 'px';

    const ctx = canvas.getContext("2d");
    ctx.scale(retina, retina); // 统一缩放处理
    ctx.clearRect(0, 0, width, height);

    const bounds = map.getBounds();
    const zoom = map.getZoom();
    const fixedRadius = 3;

    seismicStations.forEach(station => {
      if (typeof station.latitude === 'number' && typeof station.longitude === 'number') {
        const pos = map.lngLatToContainer(
          new AMap.LngLat(station.longitude, station.latitude)
        );
        
        // 视口边界检查
        if (pos.x < 0 || pos.x > size.width || pos.y < 0 || pos.y > size.height) return;

        // 绘制圆形（修复白边问题）
        ctx.save();
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, fixedRadius, 0, 2 * Math.PI);
        ctx.fillStyle = getColorForCalcShindo(station.CalcShindo);
        ctx.fill();
        ctx.restore();

        // 绘制方形边框
        if (station.CalcShindo >= 0) {
          ctx.save();
          const squareSize = 80;
          ctx.strokeStyle = getColorForCalcShindo(station.CalcShindo);
          ctx.lineWidth = 1;
          ctx.strokeRect(
            pos.x - squareSize/2, 
            pos.y - squareSize/2, 
            squareSize, 
            squareSize
          );
          ctx.restore();
        }
      }
    });
  };

  customLayer.render = onRender;
  customLayer.setMap(map);
}

// WebSocket 客户端
function connect() {
  socket = new WebSocket(wsUrl);

  // 连接成功时触发
  socket.addEventListener('open', function (event) {
    console.log('连接成功');
  });

  // 接收消息时触发
  socket.addEventListener('message', function (event) {
    const newData = JSON.parse(event.data);

    // 只处理中国的数据
    if (newData.countryName === '中国') {
      // 查找并更新对应 type 的测站数据
      const existingStationIndex = seismicStations.findIndex(station => station.type === newData.type);
      if (existingStationIndex !== -1) {
        // 更新现有测站数据
        seismicStations[existingStationIndex] = newData;
      } else {
        // 添加新的测站数据
        seismicStations.push(newData);
      }
      // 更新该测站的最后更新时间
      lastUpdateTimes[newData.type] = new Date().getTime();
      // 对数组中的数据按照 CalcShindo 值降序排序
      seismicStations.sort((a, b) => (b.CalcShindo || 0) - (a.CalcShindo || 0));
      // 更新地图上的标记
      customLayer.render();
      // 更新测站列表
      updateStationList();
      // 更新更新时间
      updateLastUpdateTime();

      // 检查震度 >= 1 的测站
      if (newData.CalcShindo >= 0) {
        // 播放相应音频
        playSoundByShindo(newData.CalcShindo);
      }
    }
  });

  // 错误处理
  socket.addEventListener('error', function (event) {
    console.error('WebSocket error:', event);
  });

  // 关闭连接时触发
  socket.addEventListener('close', function (event) {
    console.log('连接已关闭，尝试重新连接...');
    setTimeout(connect, reconnectInterval); // 尝试重新连接
  });
}

// 播放相应音频
function playSoundByShindo(shindo) {
  let soundFile;
  if (shindo >= 0 && shindo < 1) {
    soundFile = 'Shindo0.wav';
  } else if (shindo >= 1 && shindo < 2) {
    soundFile = 'Shindo1.wav';
  }
    else if (shindo >= 2 && shindo < 3) {
    soundFile = 'PGA1.wav';
  } else if (shindo >= 3 && shindo < 4) {
    soundFile = 'Shindo2.wav';
  }
    else if (shindo >= 4) {
    soundFile = 'PGA2.wav';
    }

  if (soundFile) {
    const audio = new Audio(soundFile);
    audio.play();
  }
}

// 更新上次更新时间
function updateLastUpdateTime() {
  const lastUpdatedElement = document.getElementById('last-update-time');
  const currentTime = new Date().toLocaleString();
  lastUpdatedElement.textContent = `更新时间: ${currentTime}`;
}

// 检查并删除超过5秒没有更新的测站
function checkAndRemoveStations() {
  const currentTime = new Date().getTime();
  seismicStations = seismicStations.filter(station => {
    const lastUpdateTime = lastUpdateTimes[station.type] || 0;
    const timeDiff = (currentTime - lastUpdateTime) / 1000; // 转换为秒
    if (timeDiff > 5) {
      console.log(`删除测站: ${station.type}，因为超过5秒没有更新，时间差: ${timeDiff}秒`);
      return false;
    }
    return true;
  });
  customLayer.render();
  updateStationList();

  // 如果所有测站都消失了，恢复到默认位置
  if (seismicStations.length === 0 && zoomedToStation) {
    map.setZoom(defaultZoom);
    map.setCenter(defaultCenter);
    zoomedToStation = false;
  }
}

// 更新测站列表
function updateStationList() {
  const stationItemsElement = document.getElementById('station-items');
  stationItemsElement.innerHTML = '';

  seismicStations.forEach(station => {
    const item = document.createElement('li');
    item.className = 'station-info';
    item.innerHTML = `
      <span>名称: ${station.region || '未知'}</span>
      <span>PGA: ${station.PGA !== undefined ? station.PGA.toFixed(2) : 'N/A'}</span>
      <span>震度: ${station.CalcShindo !== undefined ? station.CalcShindo.toFixed(2) : 'N/A'}</span>
    `;
    stationItemsElement.appendChild(item);
  });

  // 动态调整列表高度
  adjustStationListHeight();
}

// 动态调整列表高度
function adjustStationListHeight() {
  const stationListElement = document.getElementById('station-list');
  const stationItemsElement = document.getElementById('station-items');

  // 计算每个测站项的高度
  const itemHeight = 100; // 每个测站项的高度（包括边距）
  const totalHeight = seismicStations.length * itemHeight;

  // 设置最大高度
  const maxHeight = window.innerHeight - 250; // 保留一些空间给其他元素

  // 动态设置高度
  stationListElement.style.maxHeight = Math.min(totalHeight, maxHeight) + 'px';
}

// 重置视图
function resetView() {
  map.setZoom(defaultZoom);
  map.setCenter(defaultCenter);
}

// 初始化连接
connect();

// 每5秒检查一次测站数据
setInterval(checkAndRemoveStations, 5000);

// 初始化地图
document.addEventListener('DOMContentLoaded', function () {
  initMap();
});