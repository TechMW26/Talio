import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { GAME_DATABASE_OPTIONS, findNativeGame, playNativeGame } from '@/lib/platform/firestoreTicTacToe.server'
import { attendanceId, attendanceError } from '@/lib/platform/firestoreAttendance.server'
import { emitRealtimeEvent } from '@/lib/realtimeEvents'
import { enqueueBackgroundJob } from '@/lib/platform/firestoreBackgroundJobs.server'
async function context(request){const auth=await getAuthAndDatabase(request,GAME_DATABASE_OPTIONS);if(!auth.success)throw attendanceError(auth.message,401);return {...auth,userId:attendanceId(auth.user._id||auth.user.userId)}}
export async function GET(request){try{
 const {database,userId}=await context(request),params=new URL(request.url).searchParams,check=params.get('check'),gameId=params.get('gameId')
 if(check==='pending'){const result=await database.list('tictactoegames',{filters:[{field:'guestUserId',operator:'==',value:userId},{field:'status',operator:'==',value:'pending'}],orderBy:[{field:'createdAt',direction:'desc'}],limit:1});return NextResponse.json({success:true,invite:result.records[0]||null})}
 if(check==='history'){
  const lists=await Promise.all(['hostUserId','guestUserId'].map(field=>database.list('tictactoegames',{filters:[{field,operator:'==',value:userId},{field:'status',operator:'==',value:'ended'}],orderBy:[{field:'updatedAt',direction:'desc'}],limit:20})))
  const games=[...new Map(lists.flatMap(r=>r.records).map(g=>[g._id,g])).values()].filter(g=>g.result).sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt)).slice(0,10)
  return NextResponse.json({success:true,history:games.map(g=>{const host=g.hostUserId===userId,symbol=host?(g.hostSymbol||'X'):(g.hostSymbol==='O'?'X':'O');return {opponentName:host?g.guestName:g.hostName,outcome:g.result.winner==='draw'?'draw':g.result.winner===symbol?'win':'loss',date:g.updatedAt}})})
 }
 const game=await findNativeGame(database,gameId)
 if(!game||![game.hostUserId,game.guestUserId].includes(userId))throw attendanceError('Game not found',404)
 return NextResponse.json({success:true,game})
}catch(e){return NextResponse.json({success:false,message:e.message},{status:e.status||500})}}
export async function POST(request){try{
 const {database,user,tenant,userId}=await context(request),input=await request.json(),game=await playNativeGame(database,user,input)
 if(process.env.TALIO_LOCAL_ACCEPTANCE!=='1'){
  const recipients=input.action==='accept'||game.result?[game.hostUserId,game.guestUserId]:[game.hostUserId===userId?game.guestUserId:game.hostUserId]
  emitRealtimeEvent('tictactoe:'+input.action,{...game,lastMove:input.index},{userIds:recipients,databaseName:tenant.databaseName})
  if(input.action==='move'&&game.result)emitRealtimeEvent('tictactoe:end',{gameId:game.gameId,result:game.result},{userIds:[game.hostUserId,game.guestUserId],databaseName:tenant.databaseName})
  if(input.action==='invite')await enqueueBackgroundJob('notification',{databaseName:tenant.databaseName,userIds:[game.guestUserId],title:'🎮 '+game.hostName+' challenged you!',message:'Tap to accept and play Tic-Tac-Toe now',url:'/dashboard',data:{type:'tictactoe_invite',gameId:game.gameId,hostUserId:game.hostUserId,hostName:game.hostName,hostAvatar:game.hostAvatar}},{id:'tictactoe-invite-'+game._id}).catch(()=>{})
 }
 return NextResponse.json({success:true,game})
}catch(e){return NextResponse.json({success:false,message:e.message},{status:e.status||500})}}
