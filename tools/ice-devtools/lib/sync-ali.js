const debug = require('debug')('ice:sync');
const chalk = require('chalk');
const rp = require('request-promise-native');
const ora = require('ora');
const getDB = require('../utils/db');
const tokenUtil = require('../utils/token');
const siteUtil = require('../utils/inner-site');
const getUrl = require('../utils/inner-url');
const innerNet = require('../utils/inner-net');

/**
 * 上传数据
 * @param {Object} datas
 * @param {String} token
 * @param {Object} site
 */
async function requestUrl(data, token, url) {
  debug('requestUrl:\n%j', { data, token, url });
  const res = await rp({
    url,
    headers: {
      'x-auth-token': token,
    },
    method: 'PATCH',
    json: true,
    body: data,
  });
  if (res.success === false && Array.isArray(res.data.fail)) {
    res.data.fail.forEach((fail) =>
      console.log(
        chalk.yellow(`物料${fail.name}入库失败, 原因: ${fail.reason}`)
      )
    );
  }
}

/**
 * 上传数据
 * @param {Array<Object>} datas
 * @param {String} token
 * @param {Object} site
 */
async function uploadData(datas, token, site) {
  const baseUrl = getUrl().fusionDesignUrl;
  const url = `${baseUrl}/api/v1/sites/${site.id}/materials`;

  const spinner = ora('Sync to https://fusion.alibaba-inc.com, Now: 0%').start();

  try {
    for (let index = 0; index < datas.length; index++) {
      const data = datas[index];
      await requestUrl(data, token, url);
      const percent = Math.ceil(((index + 1) / datas.length) * 100);
      debug('index: %s, length: %s, percent: %s', index, datas.length, percent);
      spinner.text = `Sync to https://fusion.alibaba-inc.com, Now: ${chalk.green(
        percent + '%'
      )}`;
    }
    spinner.succeed(
      '已经通知 https://fusion.alibaba-inc.com 入库物料, 入库为耗时操作, 请耐心等待'
    );
  } catch (error) {
    spinner.fail('入库失败, please try icedev --help');
    debug('sync error: %o', error);
    throw error;
  }
}

/**
 * db数据重塑 如果数据量过大 会几次提交
 * @param {Object} db
 */
function dbReshape(db) {
  // 新接口 只需要 npm包名
  const blocks = db.blocks.map(({ source }) => ({
    name: source.npm,
    version: source.version,
    type: 'block',
  }));
  const scaffolds = db.scaffolds.map(({ source }) => ({
    name: source.npm,
    version: source.version,
    type: 'scaffold',
  }));
  const all = blocks.concat(scaffolds);
  debug('all : %j', all);
  const datas = [];
  const ONCE_LIMIT = 4; // 4个一批 太多了服务器受不了
  for (let i = 0; i < all.length; i += ONCE_LIMIT) {
    const data = {
      blocks: [],
      scaffolds: [],
    };
    for (let j = 0; j < ONCE_LIMIT && i + j < all.length; j++) {
      const element = all[i + j];
      debug('i: %s, j: %s \n%j\n', i, j, element);
      const { name, version, type } = element;
      const fullName = `${name}@${version}`;
      if (type === 'block') {
        data.blocks.push(fullName);
      } else if (type === 'scaffold') {
        data.scaffolds.push(fullName);
      }
    }
    if (data.blocks.length || data.scaffolds.length) {
      datas.push(data);
    }
  }

  return datas;
}
module.exports = async function sync(cwd, opt) {
  const isInnerNet = await innerNet.isInnerNet();

  if (!isInnerNet) {
    console.log(chalk.red('非内网环境, 无法运行此命令'));
    return;
  }
  const db = await getDB(cwd);
  if (!db) {
    return;
  }

  const token = await tokenUtil.tokenPrepare();
  if (!token) {
    return;
  }

  const site = await siteUtil.getSite(cwd, token);
  if (!site) {
    return;
  }

  try {
    const datas = dbReshape(db);
    await uploadData(datas, token, site);
    console.log();
    console.log();
    console.log('物料同步完成');
    console.log(`物料源地址: ${chalk.green(site.url)}`);
    console.log(`请在 Iceworks 设置面板中添加自定义物料源`);
    console.log();
    console.log();
  } catch (error) {
    console.log(chalk.red('sync fail'));
    console.log(error);
  }
};
