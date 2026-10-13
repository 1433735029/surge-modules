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
 * 数据源: myip.ipip.net (主) / ip-api.com HTTP (备)
 */

// ============ 参数解析 ============

function parseArgs(str) {
  var obj = {};
  if (!str) return obj;
  str.split('&').forEach(function (pair) {
    var idx = pair.indexOf('=');
    if (idx > -1) obj[pair.slice(0, idx)] = pair.slice(idx + 1);
  });
  return obj;
}

// ============ HTTP 工具 (带超时保护) ============

function httpGet(url, timeoutSec) {
  var ms = (timeoutSec || 5) * 1000;
  return new Promise(function (resolve, reject) {
    var settled = false;
    var timer = setTimeout(function () {
      if (!settled) {
        settled = true;
        reject(new Error('timeout'));
      }
    }, ms);
    try {
      $httpClient.get(url, { timeout: ms, policy: 'DIRECT' }, function (error, response, data) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) return reject(new Error(String(error)));
        resolve(data);
      });
    } catch (e) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(e);
      }
    }
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
    carrier: cellular.carrier || '',
    radio: cellular.radio || '',
    ipv4: ($network && $network.ipv4) || '',
    ipv6: ($network && $network.ipv6) || ''
  };
}

// ISP 名称归一化 (参考 NetRadar)
function fmtISP(isp) {
  if (!isp) return '未知';
  var s = String(isp).toLowerCase();
  var raw = String(isp).replace(/\s*[\(（]中国[\)）]\s*/g, '').replace(/\s+/g, ' ').trim();
  if (/(^|[\s-])(cmcc|cmnet|cmi|mobile)\b|移动/.test(s)) return '中国移动';
  if (/(^|[\s-])(chinanet|telecom|ctcc|ct)\b|电信/.test(s))  return '中国电信';
  if (/(^|[\s-])(unicom|cncgroup|netcom|link)\b|联通/.test(s)) return '中国联通';
  if (/(^|[\s-])(cbn|broadcast)\b|广电/.test(s))             return '中国广电';
  return raw || '未知';
}

// 运营商查询: myip.ipip.net (主) / ip-api.com HTTP (备)
async function getISP(timeoutSec) {
  // 主源: myip.ipip.net/json — location 数组最后一项为运营商
  try {
    var body = await httpGet('https://myip.ipip.net/json', timeoutSec);
    if (body) {
      var j = JSON.parse(body);
      if (j && j.data && j.data.location && j.data.location.length > 0) {
        var isp = j.data.location[j.data.location.length - 1];
        if (isp) return fmtISP(isp);
      }
    }
  } catch (_) {}

  // 备源: ip-api.com (HTTP, 免费版不支持 HTTPS)
  try {
    var body2 = await httpGet(
      'http://ip-api.com/json/?lang=zh-CN&fields=status,isp',
      timeoutSec
    );
    if (body2) {
      var j2 = JSON.parse(body2);
      if (j2 && j2.status === 'success' && j2.isp) return fmtISP(j2.isp);
    }
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

var args = parseArgs(typeof $argument !== 'undefined' ? $argument : '');
var pTimeout = parseInt(args.TIMEOUT || '5', 10) || 5;
var pIcon = args.icon || 'antenna.radiowaves.left.and.right';
var pIconColor = args['icon-color'] || '#34C759';

// 全局兜底: 确保 $done() 一定被调用
var globalTimeout = setTimeout(function () {
  $done({
    title: '网络状态',
    content: '⚠️ 查询超时, 请检查网络',
    icon: 'exclamationmark.triangle',
    'icon-color': '#FF9500'
  });
}, 15000);

function finish(result) {
  clearTimeout(globalTimeout);
  $done(result);
}

async function run() {
  // ---- 事件模式: 网络变化即时通知 ----
  if (args.TYPE === 'EVENT') {
    var delayMs = (parseInt(args.EVENT_DELAY || '1', 10) || 1) * 1000;
    await sleep(delayMs);

    var net = getLocalNetwork();
    var isp = await getISP(pTimeout);
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
    finish();
    return;
  }

  // ---- 面板模式 ----
  var net2 = getLocalNetwork();
  var isp2 = await getISP(pTimeout);
  var lines2 = buildLines(net2, isp2);

  finish({
    title: '网络状态',
    content: lines2.join('\n'),
    icon: pIcon,
    'icon-color': pIconColor
  });
}

run().catch(function (err) {
  var msg = (err && err.message) ? err.message : String(err);

  if (args.TYPE === 'EVENT') {
    $notification.post('🌐 网络状态', '查询出错', msg);
    finish();
    return;
  }

  // 面板出错时仍然显示本地网络信息
  try {
    var net = getLocalNetwork();
    var lines = buildLines(net, null);
    finish({
      title: '网络状态',
      content: lines.join('\n'),
      icon: pIcon,
      'icon-color': pIconColor
    });
  } catch (e) {
    finish({
      title: '网络状态',
      content: '❌ 查询出错: ' + msg,
      icon: 'exclamationmark.triangle',
      'icon-color': '#FF3B30'
    });
  }
});
