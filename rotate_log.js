var assert = require('assert');
var net = require('net');
var fs = require('fs');
var util = require('util');
var path = require('path');

var g_log_level = 0;

var log_stream = null;

var debug_int = 0;
var info_int = 1;
var warn_int = 2;
var err_int = 3;
var alert_int = 4;
var fatal_int = 5;

var g_has_output_log = 0;

function reopen_file(fd, filename) {
    fs.closeSync(fd);
    assert.strictEqual(fd, fs.open(filename, "a+"));
}

function unix_socket_lock(filename, sucess_call, fail_call) {
    var server = net.createServer();
    server.on('error', function(e) {
            if (e.code == 'EADDRINUSE') {
                if (fail_call) fail_call();
            }
            server.close();
    });
    server.listen(filename, function(){sucess_call(server);});
}

function recursion_mv(server, log_file, i, callback) {
    fs.rename(log_file+"."+(i-1), log_file+"."+i, function() {
        if (i > 2) {
            recursion_mv(server, log_file, i-1, callback);
        } else {
            server.close();
            if (callback) callback();
        }
    });
} 

function shift_file(path, filename, num, callback) 
{
    var log_file = path+"/"+filename;
    var lock_file = log_file +".lock";
    unix_socket_lock(lock_file, function(server) {
        recursion_mv(server, log_file, num, callback);
    });
}

function reopen_sync(filename) {
        if (log_stream) fs.closeSync(log_stream);
        log_stream = fs.openSync(filename, "a+", 0666);
}

function reopen(filename) {
    if (log_stream) {
        fs.close(log_stream);
    }
    fs.open(filename, "a+", 0666, function(err, fd) {
        if (!err) {
            log_stream = fd;
        }
    });
}

function manage_log(path, filename, num, file_size) {
    var log_file= path+"/"+filename+".1";
    fs.stat(log_file, function(err, stats) {
        if (!err) {
            if (stats.size > file_size) {
                shift_file(path, filename, num, function() {
                   reopen(log_file); 
                });
            }
        }
    });
}

function zeroize(num,width){
        var s = String(num),
        len = s.length;
        return len >= width ? s : '0000000000000000'.slice(len - width) + s;
}

function date_string(d) {
    return util.format('%d-%d-%d %d:%d:%d', 
                d.getFullYear(), 
                zeroize(d.getMonth()+1,2),
                zeroize(d.getDate(),2),
                zeroize(d.getHours(),2),
                zeroize(d.getMinutes(),2),
                zeroize(d.getSeconds(),2)
               );
}

function merge(str,obj){
  	
	return str && str.replace(/\$\{(.+?)\}/g,function($0,$1){
		
		var rs = obj && obj[$1];
		var undefined;
		
		return rs === undefined ? '' :
			typeof rs === 'string' ? rs : 
			Buffer.isBuffer(rs) ? rs.toString('base64') : 
			String(rs);
	});
}

function output_log(level, fmt, param, sync) {
    if (!log_stream) return ;
    var now = new Date();
    var str = util.format('[%s][%s]', level, date_string(now));
    str += merge(fmt, param);
    str +="\n";
    var out = new Buffer(str);
    if (sync || exports.conf.sync) {
        fs.writeSync(log_stream, out, 0, out.length, null);
    } else {
        fs.write(log_stream, out, 0, out.length, null);
    }
    if (0==g_has_output_log) {
        g_has_output_log = 1;
        process.nextTick(exports.check_log);
    }
}

exports.set_level=function(level) {
    level = level.toLowerCase(); 
    switch(true) {
      case (level == 'debug') :
            g_log_level=debug_int;
            break;

      case (level == 'info') :
            g_log_level=info_int;
            break;
      case (level == 'warn') :
            g_log_level=warn_int;
            break;
      case (level == 'error') :
            g_log_level=err_int;
            break;
      case (level == 'alert') :
            g_log_level=alert_int;
            break;
      case (level == 'fatal') :
            g_log_level=fatal_int;
            break;
      default:
            g_log_level = info_int;
    }
};


function level_string(level) {
    switch (level) {
        case 0:
            return 'debug';
        case 1:
            return 'info';
        case 2:
            return 'warn';
        case 3:
            return 'error';
        case 4:
            return 'alert';
        case 5:
            return 'fatal';
        default:
            return 'unkown';
    }
}

exports.get_level=function() {
    return level_string(g_log_level);
};

exports.debug=function(fmt, param) {
    if (g_log_level <= debug_int) {
        output_log('DEBUG', fmt, param);
    }
};

exports.info=function(fmt, param) {
    if (g_log_level <= info_int) {
        output_log('INFO', fmt, param);
    }
};

exports.warn=function(fmt, param, sync) {
    if (g_log_level <= warn_int) {
        output_log('WARN', fmt, param);
    }
};


exports.error=function(fmt, param, sync) {
    if (g_log_level <= err_int) {
        output_log('ERROR', fmt, param);
    }
};

exports.alert=function(fmt, param, sync) {
    if (g_log_level <= alert_int) {
        output_log('ALERT', fmt, param, sync);
    }
};


exports.fatal=function(fmt, param, sync) {
    if (g_log_level <= fatal_int) {
        output_log('FATAL', fmt, param, sync);
    }
};

exports.conf={};
function renice_config(conf) {
    var file_name = conf.file_name;
    if (!file_name) throw "no file name";
    var num = conf.file_num;
    if (num <=1 || num > 1000) {
        num = 10;
    }

    var file_size= conf.file_size;
    if (file_size <0) {
        file_size = 10* 1000* 1000; // 10MB
    }

    var check_time= conf.check_time;
    if (check_time <0 || check_time > 800000) {
        check_time = 10;
    }

    

    file_name = path.normalize(process.cwd()+"/"+file_name);
    var file_path = path.dirname(file_name);
    file_name = path.basename(file_name);

    conf.file_path = file_path;
    conf.file_name = file_name;
    conf.file_num = num;
    conf.file_szie = file_size;
    conf.check_time = check_time;
    return conf;
}

exports.check_log = function() {
    var conf = exports.conf;
    manage_log(conf.file_path, conf.file_name, conf.file_num, conf.file_size);
    g_has_output_log = 0;
    if (log_stream) {
        fs.fsync(log_stream);
    }
}

function mkdir(p) {
    if (fs.existsSync(p)) {
        return ;
    }
    mkdir(path.dirname(p));
    fs.mkdirSync(p, 0666);
}

exports.init=function(a_conf) {
    var conf = renice_config(a_conf);
    if (conf.log_level) exports.set_level(conf.log_level);
    var log_file = conf.file_path +"/"+conf.file_name+".1";
    mkdir(conf.file_path);
    reopen_sync(log_file);
    manage_log(conf.file_path, conf.file_name, conf.file_num, conf.file_size);
    exports.conf = conf;
};

process.on('exit', function() {
    if (log_stream) {
        fs.fsync(log_stream);
    }
});

