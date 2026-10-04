import { createHash } from 'node:crypto'
import { attendanceId, attendanceError } from './firestoreAttendance.server'
export const GAME_DATABASE_OPTIONS={queryFields:{tictactoegames:['gameId','hostUserId','guestUserId','status','createdAt','updatedAt']},constraints:{tictactoegames:[{fields:['gameId']}]}}
const lines=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]]
export function ticTacToeWinner(board){for(const[a,b,c]of lines)if(board[a]&&board[a]===board[b]&&board[a]===board[c])return {winner:board[a],line:[a,b,c]};return board.every(Boolean)?{winner:'draw',line:null}:null}
const member=(game,id)=>game&&(game.hostUserId===id||game.guestUserId===id)
export async function findNativeGame(database,gameId){if(typeof gameId!=='string'||!gameId||gameId.length>150)throw attendanceError('Invalid game ID');const list=await database.list('tictactoegames',{filters:[{field:'gameId',operator:'==',value:gameId}],limit:2});if(list.records.length>1)throw attendanceError('Duplicate game requires reconciliation',409);return list.records[0]||null}
export async function playNativeGame(database,actor,input){
 const senderId=attendanceId(actor._id||actor.userId),{action,targetUserId,gameId}=input
 if(!['invite','accept','decline','move','end','close'].includes(action))throw attendanceError('Invalid action')
 if(typeof gameId!=='string'||!gameId||gameId.length>150)throw attendanceError('Invalid game ID')
 if(!/^[a-f0-9]{24}$/.test(targetUserId||'')||targetUserId===senderId)throw attendanceError('Invalid target user')
 const imported=await findNativeGame(database,gameId),id=imported?._id||createHash('sha256').update('game:'+gameId).digest('hex').slice(0,24)
 return database.transaction(async tx=>{
  const [sender,target,current,pending]=await Promise.all([tx.get('users',senderId),tx.get('users',targetUserId),tx.get('tictactoegames',id),action==='invite'?tx.list('tictactoegames',{filters:[{field:'hostUserId',operator:'==',value:senderId},{field:'status',operator:'==',value:'pending'}],limit:100,requireComplete:true}):null])
  if(!sender||!target||sender.isActive===false||target.isActive===false)throw attendanceError('Player not found',404)
  const employee=sender.employeeId?await tx.get('employees',attendanceId(sender.employeeId)):null
  const name=[employee?.firstName,employee?.lastName].filter(Boolean).join(' ')||sender.name||sender.email||'Player',avatar=employee?.profilePicture||employee?.avatar||null,now=new Date()
  let next
  if(action==='invite'){
   if(current){if(current.hostUserId===senderId&&current.guestUserId===targetUserId)return current;throw attendanceError('Game ID is already used',409)}
   next={_id:id,gameId,hostUserId:senderId,guestUserId:targetUserId,hostName:name,hostAvatar:avatar,status:'pending',board:Array(9).fill(null),currentTurn:'X',hostSymbol:'X',result:null,createdAt:now,updatedAt:now,lastMoveAt:now}
   for(const game of pending.records)await tx.replace('tictactoegames',{...game,status:'ended',updatedAt:now})
   await tx.create('tictactoegames',next)
  }else{
   if(!member(current,senderId)||(current.hostUserId===senderId?current.guestUserId:current.hostUserId)!==targetUserId)throw attendanceError('Game not found',404)
   next={...current,updatedAt:now}
   if(action==='accept'){if(senderId!==current.guestUserId)throw attendanceError('Only the invited player can accept',403);if(!['pending','playing'].includes(current.status))throw attendanceError('Invitation is no longer active',409);next={...next,status:'playing',guestName:name,guestAvatar:avatar,lastMoveAt:now}}
   if(action==='decline'){if(senderId!==current.guestUserId||current.status!=='pending')throw attendanceError('Invitation is no longer active',409);next.status='declined'}
   if(action==='move'){
    const symbol=current.hostUserId===senderId?(current.hostSymbol||'X'):(current.hostSymbol==='O'?'X':'O')
    if(current.status!=='playing'||current.currentTurn!==symbol||input.symbol&&input.symbol!==symbol)throw attendanceError('It is not your turn',409)
    if(!Number.isInteger(input.index)||input.index<0||input.index>8||current.board[input.index])throw attendanceError('Invalid move',409)
    next.board=[...current.board];next.board[input.index]=symbol;next.currentTurn=symbol==='X'?'O':'X';next.lastMoveAt=now;next.result=ticTacToeWinner(next.board);if(next.result)next.status='ended'
   }
   if(action==='end'||action==='close'){next.status='ended';next.result=current.result||ticTacToeWinner(current.board)}
   await tx.replace('tictactoegames',next)
  }
  return next
 },{maxWrites:110})
}
