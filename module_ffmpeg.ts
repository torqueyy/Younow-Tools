import * as fs from "fs"
import {spawn,ChildProcess} from "child_process"
import {log,info,error} from "./module_utils"

/**
 * [VideoWriter description]
 * @type {[type]}
 */
export class VideoWriter
{
	private stream:fs.WriteStream=null
	private ffmpeg:ChildProcess=null
	private filename:string=null
	/**
	 * [constructor description]
	 * @param {string} filename  [description]
	 * @param {string} useFFMPEG [description]
	 */
	constructor (filename:string,useFFMPEG:string)
	{
		this.filename=filename

		if (useFFMPEG)
		{
			let params=`-i - ${useFFMPEG} ${filename}`.split(" ")

			info(`FFMPEG : ${params.join(" ")}`)

			this.ffmpeg=spawn("ffmpeg",params)

			this.ffmpeg.on("error",err=>
			{
				error(err)
			})

			this.ffmpeg.on("exit",code=>
			{
				if (code)
				{
					error(`FFMPEG exit ${code}`)
				}
			})

			this.ffmpeg.on("close",code=>
			{
				this.ffmpeg=null
			})

			this.ffmpeg.stderr.on("data",data=>
			{
				//error(data.toString())
			})

			this.ffmpeg.stdin.on("error",err=>err)
		}
		else
		{
			this.stream=fs.createWriteStream(filename)
		}
	}
	/**
	 * [close description]
	 * @param {Function} callback [description]
	 */
	close(callback:Function)
	{
		if (this.ffmpeg)
		{
			this.ffmpeg.stdin.end(callback)
		}
		else if (this.stream)
		{
			this.stream.end(callback)
		}
	}
	/**
	 * [write description]
	 * @param {Buffer}   data     [description]
	 * @param {Function} callback [description]
	 */
	write(data:Buffer,callback:Function)
	{
		if (this.ffmpeg && data)
		{
			this.ffmpeg.stdin.write(data,callback)
		}
		else if (this.stream && data)
		{
			this.stream.write(data,callback)
		}
	}
}
