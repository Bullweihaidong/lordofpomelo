var pomelo = require('pomelo');
var areaService = require('./app/services/areaService');
var instanceManager = require('./app/services/instanceManager');
var scene = require('./app/domain/area/scene');
var instancePool = require('./app/domain/area/instancePool');
var dataApi = require('./app/util/dataApi');
var routeUtil = require('./app/util/routeUtil');
var playerFilter = require('./app/servers/area/filter/playerFilter');
var ChatService = require('./app/services/chatService');

/**
 * Init app for client
 */
var app = pomelo.createApp();
app.set('name', 'lord of pomelo');

// Configure for production enviroment
app.configure('production', function() {
	// enable the system monitor modules
	app.enable('systemMonitor');
});

// configure for global
app.configure('production|development', function() {
	//var sceneInfo = require('./app/modules/sceneInfo');
	var onlineUser = require('./app/modules/onlineUser'); // pomelo服务器的监视终端
	if(typeof app.registerAdmin === 'function'){
		//app.registerAdmin(sceneInfo, {app: app});
		app.registerAdmin(onlineUser, {app: app});
	}
	//Set areasIdMap, a map from area id to serverId.
	if (app.serverType !== 'master') {   //area服务器所管理的地图
		var areas = app.get('servers').area;
		var areaIdMap = {};
		for(var id in areas){
			areaIdMap[areas[id].area] = areas[id].id;
		}
		app.set('areaIdMap', areaIdMap);
	}
	// proxy configures
	app.set('proxyConfig', {
		cacheMsg: true,
		interval: 30,
		lazyConnection: true,
		enableRpcLog: true
	});

	// remote configures
	app.set('remoteConfig', {
		cacheMsg: true,
		interval: 30
	});

	// route configures
	app.route('area', routeUtil.area);    //过滤掉玩家不能进入的非法地图
	app.route('connector', routeUtil.connector);  //过滤掉没有session 的玩家

	app.loadConfig('mysql', app.getBase() + '/../shared/config/mysql.json');
	app.filter(pomelo.filters.timeout()); //主要负责监控请求响应时间，如果超时就给出警告。
});

// Configure for auth server
app.configure('production|development', 'auth', function() { //配置用户认证服务器
	// load session congfigures
	app.set('session', require('./config/session.json')); //设置session字段
});

// Configure for area server
app.configure('production|development', 'area', function(){
	app.filter(pomelo.filters.serial()); // 主要利用队列方式，负责保证所有从客户端到服务端的请求能够按顺序地处理。
	app.before(playerFilter());          // 过滤死亡状态的玩家，进入地图

	//Load scene server and instance server
	var server = app.curServer;
	if(server.instance){
		instancePool.init(require('./config/instance.json'));
		app.areaManager = instancePool;
	}else{
		scene.init(dataApi.area.findById(server.area));  //初始化当前服务器的，area 和 map信息
		app.areaManager = scene;
	}

	//Init areaService
	areaService.init();  //初始化map列表
});

app.configure('production|development', 'manager', function(){ //管理服务器
	var events = pomelo.events;

	app.event.on(events.ADD_SERVERS, instanceManager.addServers);

	app.event.on(events.REMOVE_SERVERS, instanceManager.removeServers);
});

// Configure database
app.configure('production|development', 'area|auth|connector|master', function() {
	var dbclient = require('./app/dao/mysql/mysql').init(app); 
	app.set('dbclient', dbclient); 
	app.load(pomelo.sync, {path:__dirname + '/app/dao/mapping', dbclient: dbclient});  //配置数据回写组件，初始化回写的组件
});

app.configure('production|development', 'connector', function(){  //connctor服务器
	var dictionary = app.components['__dictionary__'];
	var dict = null;
	if(!!dictionary){
		dict = dictionary.getDict();
	}

	app.set('connectorConfig',  //参考 wiki 《数据压缩协议》 《通讯协议》
		{
			connector : pomelo.connectors.hybridconnector,
			heartbeat : 3,
			useDict : true,
			useProtobuf : true,
			handshake : function(msg, cb){
				cb(null, {});
			}
		});
});

app.configure('production|development', 'gate', function(){ //网关服务器
	app.set('connectorConfig',
		{
			connector : pomelo.connectors.hybridconnector,
		});
});
// Configure for chat server
app.configure('production|development', 'chat', function() { //聊天服务器
	app.set('chatService', new ChatService(app));
});

//start
app.start(); //start流程

// Uncaught exception handler
process.on('uncaughtException', function(err) {
	console.error(' Caught exception: ' + err.stack);
});
