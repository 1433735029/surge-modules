/*
 * 网络状态 𝕏 — Surge Module Script
 *
 * 功能:
 *   1. 显示当前网络运营商 (ISP)
 *   2. 显示 WiFi 名称 / 蜂窝 4G·5G
 *   3. 显示当前本地 IP (IPv4 / IPv6)
 *   4. 显示 IPv4 / IPv6 协议支持
 *   5. 切换网络时即时通知
 *
 * 数据源: ip.cip.cc (主) / ip-api.com (备)
 */

// ============ 参数解析 ============

function parseArgs(str) {
  const obj = {};
  if (!str) return obj;
  str.split('&').forEach(function (pair) {
    var idx = pair.indexOf('=');
    if (idx > -1) obj[pair.slice(0, idx)] = pair.slice(idx + 1);
  });
  return obj;
}

// ============ HTTP 工具 ============

function httpGet(url, timeoutSec) {
  return new Promise(function (resolve, reject) {
    var opts = { timeout: (timeoutSec || 5) * 1000 };
    $httpClient.get(url, opts, function (error, response, data) {
      if (error) return reject(new Error(String(error)));
      resolve(data);
    });
  });
}

function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

// ============ 本地网络信息 ============

function getLocalNetwork() {
  var wifi = ($network && $network.wifi) || {};
  var cellular = ($network && $network.cellular) || {};
  return {
    ssid: wifi.ssid || '',
    bssid: wifi.bssid || '',
    carrier: cellular.carrier || '',
    radio: cellular.radio || '',
    ipv4: ($network && $network.ipv4) || '',
    ipv6: ($network && $network.ipv6) || ''
  };
}

// 运营商: 先查 API, 失败则用蜂窝 carrier 兜底
async function getISP(timeoutSec) {
  // 主源 ip.cip.cc — 返回纯文本, 含 "运营商: xxx"
  try {
    var body = await httpGet('https://ip.cip.cc/', timeoutSec);
    if (body) {
      var m = body.match(/运营商[\t ]*:[\t ]*([^\r\n]+)/);
      if (m && m[1] && m[1].trim()) return m[1].trim();
    }
  } catch (_) {}

  // 备源 ip-api.com — 返回 JSON
  try {
    var body2 = await httpGet(
      'https://ip-api.com/json/?lang=zh-CN&fields=status,isp',
      timeoutSec
    );
    var j = JSON.parse(body2);
    if (j && j.status === 'success' && j.isp) return j.isp;
  } catch (_) {}

  return null;
}

// 网络类型描述
function getNetworkLabel(net) {
  if (net.ssid) {
    return { kind: 'Wi-Fi', label: 'Wi-Fi（' + net.ssid + '）' };
  }
  if (net.carrier || net.radio) {
    var radio = net.radio || '蜂窝';
    var carrier = net.carrier ? '（' + net.carrier + '）' : '';
    return { kind: '蜂窝', label: '蜂窝 ' + radio + carrier };
  }
  return { kind: '无连接', label: '无连接' };
}

// IP 协议支持
function getIPSupport(net) {
  var list = [];
  if (net.ipv4) list.push('IPv4');
  if (net.ipv6) list.push('IPv6');
  return list.length ? list.join(' / ') : '无';
}

// 构建显示行
function buildLines(net, isp) {
  var lines = [];
  var nw = getNetworkLabel(net);

  var operator = isp || net.carrier || '未知';
  lines.push('运营商: ' + operator);

  lines.push('网络: ' + nw.label);

  if (net.ipv4) lines.push('本地 IPv4: ' + net.ipv4);
  if (net.ipv6) lines.push('本地 IPv6: ' + net.ipv6);
  if (!net.ipv4 && !net.ipv6) lines.push('本地 IP: 无');

  lines.push('协议支持: ' + getIPSupport(net));

  return lines;
}

// ============ 主入口 ============

async function run() {
  var args = parseArgs(typeof $argument !== 'undefined' ? $argument : '');
  var timeout = parseInt(args.TIMEOUT || '5', 10) || 5;
  var icon = args.icon || 'antenna.radiowaves.left.and.right';
  var iconColor = args['icon-color'] || '#34C759';

  // ---- 事件模式: 网络变化即时通知 ----
  if (args.TYPE === 'EVENT') {
    var delayMs = (parseInt(args.EVENT_DELAY || '1', 10) || 1) * 1000;
    await sleep(delayMs);

    var net = getLocalNetwork();
    var isp = await getISP(timeout);
    var lines = buildLines(net, isp);
    var nw = getNetworkLabel(net);

    var subtitle;
    if (nw.kind === 'Wi-Fi') {
      subtitle = 'Wi-Fi: ' + net.ssid;
    } else if (nw.kind === '蜂窝') {
      subtitle = '蜂窝 ' + (net.radio || '');
    } else {
      subtitle = '网络已断开';
    }

    $notification.post('🌐 网络已切换', subtitle, lines.join('\n'));
    $done();
    return;
  }

  // ---- 面板模式 ----
  var net2 = getLocalNetwork();
  var isp2 = await getISP(timeout);
  var lines2 = buildLines(net2, isp2);

  $done({
    title: '网络状态',
    content: lines2.join('\n'),
    icon: icon,
    'icon-color': iconColor
  });
}

run().catch(function (err) {
  var msg = (err && err.message) ? err.message : String(err);
  var args = parseArgs(typeof $argument !== 'undefined' ? $argument : '');

  if (args.TYPE === 'EVENT') {
    $notification.post('🌐 网络状态', '查询出错', msg);
    $done();
    return;
  }

  $done({
    title: '网络状态',
    content: '❌ 查询出错: ' + msg,
    icon: 'exclamationmark.triangle',
    'icon-color': '#FF3B30'
  });
});
