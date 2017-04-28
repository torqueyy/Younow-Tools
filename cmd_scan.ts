import {settings} from "./younow"
import * as fs from "fs"
import * as _path from "path"
import * as vm from "vm"
import {execFile} from "child_process"
import {log,info,debug,dump,error} from "./module_utils"
import * as _younow from "./module_younow"
import {FakeDB,openDB} from "./module_db"

// global

let liveusers:LiveUser={}
let script=null

export function cmdScan(script_file:string,scan_interval:number)
{
	info("scan interval",scan_interval)

	new FakeDB()
	.open(_path.join(settings.pathConfig,"streams.txt"),"streams")
	.then(streams=>
	{
		return openDB()
		.then((db:DB)=>
		{
			script=parseScript(script_file)

			setInterval(()=>
			{
				update_scan(db,streams)
			},scan_interval*1000)

			update_scan(db,streams)

			fs.watchFile(settings.pathDB,(curr,prev)=>
			{
				error(`DATABASE UPDATED`)
				db.self.update()
			})
		})
	})
	.catch(error)
}

function update_scan(db:DB,streams:Array<any>)
{
	_younow.getTrendings()
	.then(function(trendings:Younow.Trendings)
	{
		let tags=trendings.trending_tags.filter(function(tag)
		{
			// 1st pass tag filtering

			return runScript(tag,null,null)||false
		}).map(tag=>tag.tag)

		var new_users=0
		var new_resolve=0

		tags.forEach(function(tag)
		{
			_younow.getTagInfo(tag)
			.then(function(infos:Younow.TagInfo)
			{
				if (infos.errorCode)
				{
					throw new Error(`${tag} ${infos.errorCode} ${infos.errorMsg}`)
				}
				else if (!infos.items)
				{
					throw new Error(`WTF`)
				}

				debug(`Tag:${tag} Users:${infos.items.length}`)

				infos.items.forEach(function(user)
				{
					var liveuser=liveusers[user.userId]

					if (!liveuser)
					{
						new_users++

						liveuser=liveusers[user.userId]=
						{
							userId:user.userId,
							broadcastId:null,
							isIgnored:false,
							isFollowed:false,
							infos:null,
							check:0
						}
					}

					if (user.userId in streams)
					{
						if (streams[user.userId].indexOf(user.broadcastId)<0)
						{
							let items=streams[user.userId]
							items.push(user.broadcastId)
							streams[user.userId]=items
						}
					}
					else
					{
						streams[user.userId]=[user.broadcastId]
					}

					let dbuser=db[user.userId]

					if (dbuser)
					{
						if (dbuser.ignore)
						{
							if (liveuser.isIgnored==false)
							{
								log(`${user.profile} is ignored`)
								liveuser.isIgnored=true
							}
							liveuser.isFollowed=false
							return
						}
						else if (liveuser.isFollowed==false)
						{
							log(`${user.profile} is live note:${dbuser.comment}`)
							liveuser.isFollowed=true
							liveuser.isIgnored=false
						}
					}

					if (liveuser.isFollowed)
					{
						if (liveuser.broadcastId==user.broadcastId)
						{
							return
						}

						log(`NEW ${user.profile} ${user.broadcastId}`)
					}
					else if (liveuser.isIgnored)
					{
						return
					}
					else
					{
						// 1st pass

						liveuser.check++

						var result=runScript(null,user,liveuser.infos)

						debug(`1ST ${liveuser.check}:${liveuser.infos?"*":""} ${result} ${user.profile} BC:${liveuser.infos&&liveuser.infos.broadcastsCount} Level:${user.userlevel} VW:${user.viewers}/${user.views} Language:${user.l}`)

						if (result=="follow")
						{
							liveuser.isFollowed=true
						}
						else if (result=="ignore")
						{
							liveuser.isIgnored=true
							return
						}
						else if (result!="resolve")
						{
							return
						}
					}

					Promise.resolve(liveuser.infos)
					.then(function(infos)
					{
						if (infos)
						{
							if (infos.broadcastId!=user.broadcastId)
							{
								new_resolve++

								info(`update infos for ${user.profile}`)
								return _younow.getLiveBroadcastByUID(user.userId)
							}
							else
							{
								return infos
							}
						}
						else
						{
							new_resolve++
							return _younow.getLiveBroadcastByUID(user.userId)
						}
					})
					.then(function(infos)
					{
						if (infos.errorCode==206)
						{
							info(`${user.profile} ${infos.errorCode} ${infos.errorMsg}`)
							return
						}
						else if (infos.errorCode)
						{
							throw new Error(`${infos.errorCode} ${infos.errorMsg}`)
						}

						liveuser.infos=infos

						if (liveuser.isFollowed==false)
						{
							// 2nd pass with more informations

							liveuser.check++

							var result=runScript(null,user,infos) || null

							if (result=="follow")
							{
								liveuser.isFollowed=true
							}
							else if (result=="ignore")
							{
								liveuser.isIgnored=true
								return
							}
							else
							{
								// waiting

								return
							}
						}

						if (liveuser.isFollowed)
						{
							log(`MATCH ${user.profile} Viewers:${infos.viewers}/${user.viewers} ${infos.country} state:${infos.stateCopy+" "+infos.state} BC:${infos.broadcastsCount} Partner:${infos.partner} Platform:${infos.platform}`)
							liveuser.infos=infos
							liveuser.broadcastId=user.broadcastId

							return _younow.downloadThemAll(infos)
							.then(([thumb,video,json])=>
							{
								log(`${user.profile} is over json : ${thumb} image : ${video} video :${json}`)
							},err=>
							{
								error(err)
							})
						}
					})
					.catch(error)
				})
			})
			.catch(error)
			.then(function()
			{
				if (new_resolve) debug(`result new users:${new_users} resolve:${new_resolve}`)
			})
		})
	})
	.catch((err)=>
	{
		error(err)
	})
}

function parseScript(filename)
{
	var code=fs.readFileSync(filename).toString()
	return new vm.Script(code)
}

function runScript(tag,user:Younow.TagInfoUser,broadcast)
{
	try
	{
		var context=new (vm as any).createContext(
		{
			"tag":tag,
			"user":user,
			"broadcast":broadcast,
			"log":log
		})

		return script.runInContext(context)
	}
	catch(e)
	{
		error(e)
		return null
	}
}