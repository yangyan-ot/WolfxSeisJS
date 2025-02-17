const wsUrl = 'wss://seisjs.wolfx.jp/all_seis';
let socket;
let reconnectInterval = 1000; // 1秒重连间隔
let seismicStations = []; // 存储地震测站数据的数组
let lastUpdateTimes = {}; // 记录每个测站的最后更新时间

function connect() {
  socket = new WebSocket(wsUrl);

  // 连接成功时触发
  socket.addEventListener('open', function (event) {
    console.log('连接成功');
  });

  // 接收消息时触发
  socket.addEventListener('message', function (event) {
    const newData = JSON.parse(event.data);
    
    // 只处理来自中国的测站数据
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
      // 对数组中的数据按照PGA值降序排序
      seismicStations.sort((a, b) => (b.PGA || 0) - (a.PGA || 0));
      // 更新表格
      updateTable(seismicStations);
      // 更新更新时间
      updateLastUpdateTime();
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

// 更新表格
function updateTable(stations) {
  const table = document.getElementById('seismicData');
  
  // 清空现有行
  while (table.rows.length > 1) {
    table.deleteRow(1);
  }
  
  // 遍历所有测站数据，插入新行
  stations.forEach(station => {
    const row = table.insertRow();
    row.insertCell().innerText = station.region || '未知';
    row.insertCell().innerText = (station.PGA || 0).toFixed(2);
    row.insertCell().innerText = (station.PGV || 0).toFixed(2);
    row.insertCell().innerText = (station.PGD || 0).toFixed(2);
    row.insertCell().innerText = (station.Max_PGA || 0).toFixed(2);
    row.insertCell().innerText = (station.Max_PGV || 0).toFixed(2);
    row.insertCell().innerText = (station.Max_PGD || 0).toFixed(2);
    row.insertCell().innerText = (station.Intensity || 0).toFixed(1);
    row.insertCell().innerText = (station.Max_Intensity || 0).toFixed(1);
    row.insertCell().innerText = station.Shindo || '未知';
    row.insertCell().innerText = station.Max_Shindo || '未知';
  });
}

// 更新上次更新时间
function updateLastUpdateTime() {
  const lastUpdatedElement = document.getElementById('lastUpdated');
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
  updateTable(seismicStations);
}

// 初始化连接
connect();

// 每5秒检查一次测站数据
setInterval(checkAndRemoveStations, 5000);