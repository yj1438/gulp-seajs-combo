/*
 * seajs(CMD) Module combo pulgin for gulp
 * Author : chenmnkken@gmail.com
 * Date : 2015-03-30
 */

var Promise = require('promise'),
    fs = require('fs'),
    path = require('path'),
    through = require('through2'),
    gutil = require('gulp-util'),
    execPlugins = require('./lib/execplugins'),
    hasReadFile = [],

    rFirstStr = /[\s\r\n\=]/,
    rDefine = /define\(\s*(['"](.+?)['"],)?/,
    rDeps = /(['"])(.+?)\1/g,
    rAlias = /alias\s*\:([^\}]+)\}/,
    rPaths = /paths\s*\:([^\}]+)\}/,
    rVars = /vars\s*\:([^\}]+)\}/,
    rVar = /\{([^{]+)}/g,
    rSeajsConfig = /seajs\.config\([^\)]+\);?/g,
    rModId = /([^\\\/?]+?)(\.(?:js))?([\?#].*)?$/,
    rQueryHash = /[\?#].*$/,
    rExistId = /define\(\s*['"][^\[\('"\{\r\n]+['"]\s*,?/,
    rSeajsUse = /"(?:\\"|[^"])*"|'(?:\\'|[^'])*'|\/\*[\S\s]*?\*\/|\/(?:\\\/|[^\/\r\n])+\/(?=[^\/])|\/\/.*|\.\s*seajs\.use|(?:^|[^$])\bseajs\.use\s*\((.+)/g,
    rRequire = /"(?:\\"|[^"])*"|'(?:\\'|[^'])*'|\/\*[\S\s]*?\*\/|\/(?:\\\/|[^\/\r\n])+\/(?=[^\/])|\/\/.*|\.\s*require|(?:^|[^$])\brequire\s*\(\s*(["'])(.+?)\1\s*\)/g;

const PLUGIN_NAME = 'gulp-seajs-cmobo';

/*
 * 过滤忽略模块
 * param { Array } 忽略模块列表
 * param { String } 模块名
 * param { String } 模块标识
 * return { Boolean } 是否在忽略列表中
 */
var filterIgnore = function (ignore, id, origId) {
        return ignore.some(function (item) {
            var arr;

            // 含路径的模块id只过滤精确匹配的结果
            if (~item.indexOf('/')) {
                return item === origId;
            }
            // 不含路径的模块id将过滤所有匹配结果
            // ui 将匹配 ../ui 和 ../../ui
            else {
                // 使用id过滤忽略模块时要去掉自动添加的 gulp-seajs-combo
                if (~id.indexOf(PLUGIN_NAME)) {
                    arr = id.split('_');
                    id = arr.slice(0, -2).join('_');
                }

                return item === id;
            }
        });
    },

    /*
     * 初始化插件
     * param { Object } 老配置对象
     * param { Object } 新忽略列表
     */
    initPlugins = function (options, o) {
        var name;

        o.plugins = {};

        options.plugins.forEach(function (item) {
            item.ext.forEach(function (name) {
                o.plugins[name] = item.use;
            });
        });
    },

    /*
     * 提取config中的配置，会忽略包含变量的配置，只提取纯字符串
     * param{ String } config字符串
     * return{ Object } 提取出来的配置
     */
    evalConfig = function (configStr) {
        var configArr = configStr,
            config = {};

        configStr = configStr.replace(/\{/, '');
        configArr = configStr.split(',');

        configArr.forEach(function (item) {
            var index, arr, key, value;

            index = item.indexOf(':');
            key = item.slice(0, index).replace(/['"]/g, '');
            value = item.slice(index + 1);

            key = key.trim();
            value = value.trim();

            try {
                value = eval('(function(){return ' + value + '})()');
                config[key] = value;
            } catch (_) {}
        });

        return config;
    },

    /*
     * 解析config字符串，尝试提取alias、paths、vars
     * param{ String } 文件内容
     * return{ Object } 提取出来的配置和提取后的文件内容
     */
    parseConfig = function (contents) {
        var config = {};

        contents = contents.replace(rSeajsConfig, function ($) {
            $.replace(rAlias, function (_, $1) {
                config.alias = evalConfig($1);
            });

            $.replace(rPaths, function (_, $1) {
                config.paths = evalConfig($1);
            });

            $.replace(rVars, function (_, $1) {
                config.vars = evalConfig($1);
            });

            return '';
        });

        return {
            contents: contents,
            config: config
        }
    },

    /*
     * ====================================4
     * (此方法现在已经不用了)
     * 基于base将依赖模块的相对路径转化成绝对路径
     * 同时对seajs.config中的paths、alias、vars，还有options.map进行处理
     * param { Object } 数据存储对象
     * param { Array } 依赖模块的相对路径列表
     * param { String } 基础路径
     * return { Array } 依赖模块的绝对路径列表
     */
    /*
    mergePath = function (options, deps, base) {
        var config = options.config;
        return deps.map(function (item, i) {
            var origId = item.origId,
                arr, modId, id;
            // 防止多次merge
            if (item.path) {
                return item;
            }

            // 处理build.json => map
            if (options.map && options.map[origId]) {
                origId = options.map[origId];
            }

            // 处理seajs.config => vars
            if (config.vars) {
                if (~origId.indexOf('{')) {
                    origId = origId.replace(rVar, function ($, $1) {
                        if (config.vars[$1]) {
                            return config.vars[$1];
                        }

                        return $;
                    });
                }
            }

            // 处理seajs.config => alias
            if (config.alias && config.alias[origId]) {
                origId = config.alias[origId];
            }

            // 处理seajs.config => paths
            if (config.paths) {
                arr = origId.split('/');
                modId = arr.splice(arr.length - 1, 1);

                arr.forEach(function (_item, i) {
                    if (config.paths[_item]) {
                        arr[i] = config.paths[_item];
                    }
                });

                arr = arr.concat(modId);
                origId = arr.join('/');
            }
            //=======================================================================

            
            id = item.id;
//            if (options.ignore && options.ignore.indexOf(id) > -1) {
//                //console.log(id);
//            } else {
//                if (options.base && options.basepath) {
//                    id = path.relative(options.basepath, path.resolve(base, origId));
//                    id = id.replace(/\\/g, "/") //将windows下的反斜线转成斜线
////                        .replace(/^\/|\.\w+$/g, ""); //去掉路径最前面的斜杠和和后缀
//                        .replace(/^\/|\.js$/g, ""); //去掉路径最前面的斜杠和和后缀
//                }
//            }
            var data = {
                id: id,
                extName: item.extName,
                path: path.resolve(base, origId),
                origId: origId
            };
            return data;
        });
    },
    */

    /*
     * ===========================2
     * 根据文件的绝对地址解析模块标识
     * param { Object } 配置参数
     * param { String } 文件的物理地址
     * return { Object } filePath: 过滤query和hash后的模块标识,id: 模块id,extName: 模块后缀
     */
    modPathResolve = function (options, filePath) {
        // 过滤query(?)和hash(#)
        filePath = filePath.replace(rQueryHash, '');
        //=================================================================================
        var match = filePath.match(rModId),
            id = match[1],
            extName = match[2];
        
//        if (extName && extName === '.js') {
//            id = id.replace(extName, '');
//        }
        id = path.relative(options.basepath, filePath);
//        if (options.ignore && options.ignore.indexOf(id) > -1) {
//            filePath = id;
//        } else {
//            id = options.base ? path.relative(options.basepath, filePath) : id;
//        }
//        
        return {
            id: id,
            path: filePath,
            extName: extName
        };
    },

    /*
     * 解析依赖模块列表，如果有依赖模块则开始解析依赖模块
     * param { Object } 配置参数
     * param { Array } 依赖模块
     * param { promise }
     * （递归方法）
     */
    readDeps = function (options, parentDeps) {
        var childDeps = [];
        promiseArr = parentDeps.map(function (item) {
            return new Promise(function (resolve, reject) {
                var id = item.id,
                    extName = item.extName,
                    filePath = item.path,
                    origId = item.origId,
                    contents, stream, plugins, deps, isIgnore;

                isIgnore = options.ignore ?
                    filterIgnore(options.ignore, id, origId) :
                    false;

                // 检测该模块是否在忽略列表中
                if (isIgnore) {
                    options.modArr.push({
                        id: id,
                        path: filePath,
                        contents: '',
                        extName: extName,
                        origId: origId
                    });

                    resolve();
                    return;
                }

                // 处理特殊的模块，如 tpl 模块（需额外的插件支持）
                // 根据模块后缀来匹配是否使用插件
                if (extName && !~extName.indexOf('.js')) {
                    if (options.plugins && options.plugins[extName]) {
                        plugins = options.plugins[extName];

                        if (!plugins) {
                            reject("Can't combo unkonwn module [" + filePath + "]");
                            return;
                        }
                    }

                    // 有插件则执行插件
                    stream = execPlugins(filePath, plugins);

                    stream.on('end', function () {
                        resolve();
                    });

                    stream.pipe(through.obj(function (file, enc, _callback) {
                        parseDeps(options, file.contents.toString(), item);
                        _callback(null, file);
                    }));
                }
                // 处理普通的js模块
                else {
                    if (!extName && filePath.slice(-3) !== '.js') {
                        filePath += '.js'
                    }
                    if (hasReadFile.indexOf(filePath) === -1) {
                        try {
                            console.log('start read file : ' + filePath);
                            contents = fs.readFileSync(filePath, options.encoding);
                        } catch (_) {
                            reject("File [" + filePath + "] not found.");
                            return;
                        }

                        deps = parseDeps(options, contents, item);

                        if (deps.length) {
                            childDeps = childDeps.concat(deps);
                        }
                        hasReadFile.push(filePath);
                    }

                    resolve();
                }
            });
        });

        return Promise.all(promiseArr).then(function () {
                if (childDeps.length) {
                    return readDeps(options, childDeps);
                }
            }, function (err) {
                gutil.log(gutil.colors.red(PLUGIN_NAME + ' Error: ' + err));
            })
            .catch(function (err) {
                gutil.log(gutil.colors.red(PLUGIN_NAME + ' error: ' + err.message));
                console.log(err.stack);
            });
    },

    /*
     * 提取依赖模块
     * param { Object } 配置参数
     * param { RegExp } 提取正则
     * param { Object } 文件内容
     * return { Array } 依赖模块列表
     */
    pullDeps = function (options, reg, contents, base) {
        var deps = [],
            matches,
            origId,
            filePath;

        reg.lastIndex = 0;

        while ((matches = reg.exec(contents)) !== null) {
            origId = matches[2];
            if (origId && origId.slice(0, 4) !== 'http') {
                if (filterIgnore(options.ignore, origId)) {
                    deps.push({
                        id: origId,
                        origId: origId,
                        extName: '',
                        path: ''
                    });
                } else {
                    if (base) {
                        filePath = path.resolve(base, origId) + '.js';
                    }
                    modData = modPathResolve(options, filePath);
                    deps.push({
                        id: modData.id,
                        origId: origId,
                        extName: modData.extName,
                        path: base ? filePath : ''
                    });
                }
            }
        }
        return deps;
    },

    /*
     * ==============================3
     * 解析依赖模块
     * param { Object } 配置参数
     * param { String } 文件内容
     * param { Object } 模块数据
     * return { Array } 依赖模块数据列表
     *
     * modData: { id: 'a', path: './a', extName: '' }
     * id: 一般是文件名去掉 JS，
     * path 除 main 文件，其它都是相对路径
     * extName,
     * origId: require 的 ID
     */
    parseDeps = function (options, contents, modData) {
        var isSeajsUse = !!~contents.indexOf('seajs.use('),
            id = modData.id,
            deps = [],
            base = path.resolve(modData.path, '..'),
            configResult, name, base, matches;
        
        // 标准模块
        if (!isSeajsUse) {
            deps = pullDeps(options, rRequire, contents, base);
        }
        // 解析seajs.use
        else {
            configResult = parseConfig(contents);
            contents = configResult.contents;

            for (name in configResult.config) {
                options.config[name] = configResult.config[name];
            }

            matches = contents.match(rSeajsUse);

            matches.forEach(function (item) {
                var _deps = [];

                if (~item.indexOf('seajs.use')) {
                    _deps = pullDeps(options, rDeps, item, base);
                    deps = deps.concat(_deps);
                }
            });
        }

        /*
        * 关键方法，找出此文件的依赖文件
        * 输入deps = [{id: , extName: , origId: }...]
        * 输出deps = [{id: , extName: , path: , origId: }...]
        */
        //deps = mergePath(options, deps, base);
        
        
        /*
        * 将每个文件对应的依赖放在 options中
        */
        options.modArr.push({
            id: id,
            deps: deps,
            path: modData.path,
            contents: contents,
            extName: modData.extName,
            origId: modData.origId || id
        });

        return deps;
    },

    /*
     * 转换模块内容
     * param { Object } 配置参数
     * param { Object } 模块数据
     * param { Object } id映射表
     * return { String } 文件内容
     */
    transform = function (options, modData, idMap) {
        var contents = modData.contents,
            isSeajsUse = !!~contents.indexOf('seajs.use('),
            origId = modData.origId,
            deps = [];
        idMap = {};
        if (modData.deps) {
            modData.deps.forEach(function (item) {
                idMap[item.origId] = item.id;
            });
        }

        // 标准模块
        if (!isSeajsUse) {
                        
            contents = contents.replace(rRequire, function ($, _, $2) {
                var result = $,
                    depId, depOrigId, depPathResult, firstStr;

                if ($2 && $2.slice(0, 4) !== 'http') {
                    firstStr = result.charAt(0);
                    depId = idMap[$2];
                    deps.push(depId);
                    result = "require('" + depId + "')";
                    if (rFirstStr.test(firstStr)) {
                        result = firstStr + result;
                    }
                }
                return result;
            });

            // 为匿名模块添加模块名，同时将依赖列表添加到头部
            contents = contents.replace(rDefine, function () {
                var id = modData.id;
                return deps.length ?
                    "define('" + id + "',['" + deps.join("','") + "']," :
                    "define('" + id + "',";
            });
        } else {
            contents = contents.replace(rSeajsUse, function ($) {
                var result = $;

                if (~$.indexOf('seajs.use(')) {
                    result = $.replace(rDeps, function ($, _, $2) {
                        var _result = $,
                            depPathResult, depId;

                        if ($2 && $2.slice(0, 4) !== 'http') {
                            depId = idMap[$2];
                            _result = "'" + depId + "'";
                        }

                        return _result;
                    });
                }

                return result;
            });
        }

        return contents;
    },

    /*
     * 合并模块内容
     * param { Object } 配置参数
     * return { String } 文件内容
     */
    comboContent = function (options) {
        var idUnique = {},
            pathUnique = {},
            contents = '',
            idMap = {},
            newModArr = [];

        options.modArr.forEach(function (item, i) {
            var obj = {},
                id = item.id,
                filePath = item.path;
            if (!pathUnique[filePath]) {
                pathUnique[filePath] = true;
                newModArr.push(item);

                if (idUnique[id]) {
                    //                    id = id + '_' + PLUGIN_NAME + '_' + i;
                } else {
                    idUnique[id] = true;
                }

                idMap[item.origId] = id;
            }
        });
        
        newModArr.forEach(function (item) {
            var newContents = transform(options, item, idMap);
            if (newContents) {
                contents = newContents + '\n' + contents;
            }

            if (options.verbose) {
                gutil.log('gulp-seajs-combo:', '✔ Module [' + filePath + '] combo success.');
            }
        });

        return new Buffer(contents);
    },

    /*
     * ======================1
     * 解析模块的内容，如果有依赖模块则开始解析依赖模块
     * param { Object } 数据存储对象
     * param { String } 文件内容
     * param { String } 模块的绝对路径
     * param { promise }
     */
    parseContent = function (options, contents, file) {
        gutil.log(gutil.colors.green('start read file : ' + file.path));
        return new Promise(function (resolve) {
            var filePath = file.path;
            //添加模块 ID 的相对路径：file.cwd-当前gulp 执行路径；file.base-当前配置的 base 相对路径
            if (options.base) {
                options.basepath = path.resolve(file.cwd, file.base);
            } else {
                options.basepath = file.cwd;
            }
            var modData = modPathResolve(options, filePath),
                deps;
                deps = parseDeps(options, contents, modData);

            if (deps.length) {
                resolve(readDeps(options, deps));
            } else {
                resolve();
            }
        });
    },

    // 插件入口函数
    createStream = function (options) {
        var o = {
            modArr: [],
            config: {},
            unique: {},
            uuid: 0,
            base: false,
            contents: '',
            encoding: 'UTF-8',
            verbose: !!~process.argv.indexOf('--verbose')
        };

        if (options) {
            if (options.base) {
                o.base = true;
            }

            if (options.ignore) {
                o.ignore = options.ignore;
            }

            if (options.map) {
                o.map = options.map;
            }

            if (options.encoding) {
                o.encoding = options.encoding;
            }

            if (options.plugins) {
                initPlugins(options, o);
            }
        }

        return through.obj(function (file, enc, callback) {
            //=======================================================================================

            if (file.isBuffer()) {
                parseContent(o, file.contents.toString(), file)
                    .then(function () {
                        var contents = comboContent(o);
                        file.contents = contents;
                        callback(null, file);
                    })
                    .catch(function (err) {
                        gutil.log(gutil.colors.red(PLUGIN_NAME + ' error: ' + err.message));
                        console.log(err.stack);
                        callback(null, file);
                    });
            } else {
                callback(null, file);
            }
        });
    };

module.exports = createStream;