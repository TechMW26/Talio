import {randomBytes} from 'node:crypto'
import {Firestore} from 'firebase-admin/firestore'
import {createFirestoreDatabase} from '@/lib/platform/firestoreStore.server'
import {GAME_DATABASE_OPTIONS,playNativeGame,ticTacToeWinner} from '@/lib/platform/firestoreTicTacToe.server'
jest.mock('@/lib/platform/firestoreApplication.server',()=>({getFirestoreTenantDatabase:jest.fn()}))
const emulator=process.env.TALIO_FIRESTORE_EMULATOR_TEST==='1'?describe:describe.skip
jest.setTimeout(30000)
test.each([[[0,1,2],'X'],[[3,4,5],'O'],[[6,7,8],'X'],[[0,3,6],'X'],[[1,4,7],'O'],[[2,5,8],'X'],[[0,4,8],'X'],[[2,4,6],'O']])('detects winning line %j',(line,symbol)=>{const board=Array(9).fill(null);for(const index of line)board[index]=symbol;expect(ticTacToeWinner(board)).toEqual({winner:symbol,line})})
test('detects draws and unfinished boards',()=>{expect(ticTacToeWinner(['X','O','X','X','O','O','O','X','X'])).toEqual({winner:'draw',line:null});expect(ticTacToeWinner(Array(9).fill(null))).toBeNull()})
emulator('native game persistence and authorization',()=>{
 let firestore,database
 const host={_id:'111111111111111111111111',role:'employee',isActive:true},guest={_id:'222222222222222222222222',role:'employee',isActive:true},intruder={_id:'333333333333333333333333',role:'employee',isActive:true}
 const action=(actor,name,extra={})=>playNativeGame(database,actor,{action:name,targetUserId:actor._id===host._id?guest._id:host._id,gameId:'game-one',...extra})
 beforeAll(()=>{if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8185')throw new Error('Isolated emulator required');firestore=new Firestore({projectId:'demo-talio-firestore'})})
 afterAll(()=>firestore.terminate())
 beforeEach(async()=>{database=createFirestoreDatabase({firestore,dataset:'test-games-'+randomBytes(8).toString('hex'),databaseName:'talio_company_games_test',...GAME_DATABASE_OPTIONS});for(const u of[host,guest,intruder])await database.create('users',u)})
 test('retry invitation creates one game, only invited guest can accept',async()=>{
  await Promise.all([action(host,'invite'),action(host,'invite')]);expect(await database.count('tictactoegames')).toBe(1)
  await expect(action(host,'accept')).rejects.toMatchObject({status:403})
  await expect(action(intruder,'accept')).rejects.toMatchObject({status:404})
  expect(await action(guest,'accept')).toMatchObject({status:'playing',currentTurn:'X'})
 })
 test('moves enforce participant, turn and cell and serialize duplicate requests',async()=>{
  await action(host,'invite');await action(guest,'accept')
  await expect(action(guest,'move',{index:0,symbol:'O'})).rejects.toMatchObject({status:409})
  const moves=await Promise.allSettled([action(host,'move',{index:0,symbol:'X'}),action(host,'move',{index:1,symbol:'X'})])
  expect(moves.filter(r=>r.status==='fulfilled')).toHaveLength(1)
  const game=moves.find(r=>r.status==='fulfilled').value
  expect(game.board.filter(Boolean)).toHaveLength(1)
  await expect(action(guest,'move',{index:game.board.indexOf('X'),symbol:'O'})).rejects.toMatchObject({status:409})
 })
 test('server computes winner and ignores forged client result',async()=>{
  await action(host,'invite');await action(guest,'accept')
  for(const[actor,index]of[[host,0],[guest,3],[host,1],[guest,4],[host,2]])await action(actor,'move',{index})
  const ended=await action(guest,'end',{result:{winner:'O'}})
  expect(ended).toMatchObject({status:'ended',result:{winner:'X',line:[0,1,2]}})
  await expect(action(host,'move',{index:8})).rejects.toMatchObject({status:409})
 })
 test('foreign tenant target is rejected without creating a game',async()=>{
  await expect(action(host,'invite',{targetUserId:'aaaaaaaaaaaaaaaaaaaaaaaa'})).rejects.toMatchObject({status:404})
  expect(await database.count('tictactoegames')).toBe(0)
 })
})
