import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {Article,Category,Location,User,AuditLog,ImportedNews,Visitor,PageView} from './models.js';

const app=express(),port=process.env.PORT||5000,prod=process.env.NODE_ENV==='production';
app.set('trust proxy',1);app.use(helmet());app.use(cors({origin:process.env.CLIENT_URL||'http://localhost:5173',credentials:true}));app.use(express.json({limit:'1mb'}));
if(!process.env.SESSION_SECRET||process.env.SESSION_SECRET.length<32)console.warn('SESSION_SECRET should contain at least 32 characters.');
app.use(session({name:'vm.sid',secret:process.env.SESSION_SECRET||'development-only-change-this-session-secret',resave:false,saveUninitialized:false,store:MongoStore.create({mongoUrl:process.env.MONGODB_URI||'mongodb://127.0.0.1:27017/valsadmedia',touchAfter:24*3600}),cookie:{httpOnly:true,sameSite:'lax',secure:prod,maxAge:8*60*60*1000}}));
const api=express.Router();app.use('/api/v1',api);
const safeArticle={status:'published',publishedAt:{$lte:new Date()}};
const auth=(req,res,next)=>req.session.user?next():res.status(401).json({error:'Authentication required'});
const admin=(req,res,next)=>req.session.user?.role==='admin'?next():res.status(403).json({error:'Administrator access required'});
const audit=(req,action,entity,entityId)=>AuditLog.create({user:req.session.user?.id,action,entity,entityId,ip:req.ip});
api.get('/health',(_,res)=>res.json({ok:true,service:'ValsadMedia API'}));
const visitorInput=z.object({visitorId:z.string().uuid(),path:z.string().regex(/^\/(en|gu)(\/|$)/).max(300)});
const updateVisitor=async(visitorId,path)=>{
 const now=new Date(),update={$set:{lastSeen:now,currentPath:path},$setOnInsert:{visitorId,firstSeen:now}};
 try{await Visitor.updateOne({visitorId},update,{upsert:true})}
 catch(error){if(error.code!==11000)throw error;await Visitor.updateOne({visitorId},{$set:update.$set})}
};
api.post('/visitors/view',async(req,res,next)=>{try{const {visitorId,path}=visitorInput.parse(req.body);await Promise.all([updateVisitor(visitorId,path),PageView.create({visitorId,path})]);res.status(202).json({ok:true})}catch(e){next(e)}});
api.post('/visitors/heartbeat',async(req,res,next)=>{try{const {visitorId,path}=visitorInput.parse(req.body);await updateVisitor(visitorId,path);res.status(204).end()}catch(e){next(e)}});
api.post('/auth/login',rateLimit({windowMs:15*60*1000,limit:8,standardHeaders:true,legacyHeaders:false}),async(req,res,next)=>{try{const {email,password}=z.object({email:z.string().email(),password:z.string().min(1).max(200)}).parse(req.body);const user=await User.findOne({email:email.toLowerCase(),isActive:true});if(!user||!await bcrypt.compare(password,user.passwordHash))return res.status(401).json({error:'Invalid email or password'});user.lastLoginAt=new Date();await user.save();req.session.user={id:user.id,name:user.name,email:user.email,role:user.role};res.json({user:req.session.user})}catch(e){next(e)}});
api.post('/auth/logout',(req,res)=>req.session.destroy(()=>{res.clearCookie('vm.sid');res.json({ok:true})}));api.get('/auth/me',(req,res)=>res.json({user:req.session.user||null}));
api.get('/articles',async(req,res,next)=>{try{const page=Math.max(1,Number(req.query.page)||1),limit=Math.min(30,Math.max(1,Number(req.query.limit)||12)),filter={...safeArticle};if(req.query.category)filter.category=req.query.category;if(req.query.location)filter.locations=req.query.location;const [items,total]=await Promise.all([Article.find(filter).sort({publishedAt:-1}).skip((page-1)*limit).limit(limit).populate('category','name slug').populate('locations','name slug'),Article.countDocuments(filter)]);res.json({items,total,page,pages:Math.ceil(total/limit)})}catch(e){next(e)}});
api.get('/articles/featured',async(_,res,next)=>{try{res.json(await Article.find({...safeArticle,featured:true}).sort({publishedAt:-1}).limit(8))}catch(e){next(e)}});api.get('/articles/latest',async(req,res,next)=>{try{res.json(await Article.find(safeArticle).sort({publishedAt:-1}).limit(Math.min(30,Number(req.query.limit)||12)))}catch(e){next(e)}});api.get('/articles/trending',async(_,res,next)=>{try{res.json(await Article.find({...safeArticle,trending:true}).sort({publishedAt:-1}).limit(8))}catch(e){next(e)}});
api.get('/articles/by-location/:locationId',async(req,res,next)=>{try{res.json(await Article.find({...safeArticle,locations:req.params.locationId}).sort({publishedAt:-1}).limit(30))}catch(e){next(e)}});
api.get('/articles/:slug',async(req,res,next)=>{try{const lang=req.query.lang==='en'?'en':'gu',a=await Article.findOne({...safeArticle,[`slug.${lang}`]:req.params.slug}).populate('category').populate('locations');if(!a)return res.status(404).json({error:'Article not found'});res.json(a)}catch(e){next(e)}});
api.get('/categories',async(_,res,next)=>{try{res.json(await Category.find({isActive:true}).sort({sortOrder:1}))}catch(e){next(e)}});api.get('/locations',async(req,res,next)=>{try{const f={isActive:true};if(req.query.parent)f.parent=req.query.parent;if(req.query.type)f.type=req.query.type;res.json(await Location.find(f).sort({name:1}))}catch(e){next(e)}});api.get('/locations/:id/children',async(req,res,next)=>{try{res.json(await Location.find({parent:req.params.id,isActive:true}).sort({name:1}))}catch(e){next(e)}});
api.get('/search',async(req,res,next)=>{try{const q=String(req.query.q||'').trim().slice(0,100);if(!q)return res.json({items:[],total:0,page:1});const page=Math.max(1,Number(req.query.page)||1),filter={...safeArticle,$text:{$search:q}};if(req.query.category)filter.category=req.query.category;if(req.query.location)filter.locations=req.query.location;const [items,total]=await Promise.all([Article.find(filter,{score:{$meta:'textScore'}}).sort({score:{$meta:'textScore'}}).skip((page-1)*12).limit(12),Article.countDocuments(filter)]);res.json({items,total,page,pages:Math.ceil(total/12)})}catch(e){next(e)}});
api.use('/admin',auth,admin);
api.post('/admin/uploads/signature',(req,res)=>{
 const {CLOUDINARY_CLOUD_NAME:cloudName,CLOUDINARY_API_KEY:apiKey,CLOUDINARY_API_SECRET:apiSecret}=process.env;
 if(!cloudName||!apiKey||!apiSecret)return res.status(503).json({error:'Image uploads are not configured. Add the Cloudinary credentials to the server environment.'});
 const timestamp=Math.floor(Date.now()/1000),folder='valsadmedia/articles',publicId=`${randomUUID()}`;
 const parameters=`folder=${folder}&public_id=${publicId}&timestamp=${timestamp}`;
 const signature=createHash('sha1').update(`${parameters}${apiSecret}`).digest('hex');
 res.json({cloudName,apiKey,timestamp,folder,publicId,signature});
});
api.get('/admin/analytics',async(req,res,next)=>{
 try{
  const range=String(req.query.range||'last-week');
  if(!['today','tomorrow','last-week','month','year'].includes(range))return res.status(400).json({error:'Choose today, tomorrow, last-week, month, or year.'});
  const offset=330*60*1000,now=new Date(),localNow=new Date(now.getTime()+offset);
  const year=localNow.getUTCFullYear(),month=localNow.getUTCMonth(),day=localNow.getUTCDate();
  const localDate=(y,m,d,h=0)=>new Date(Date.UTC(y,m,d,h)-offset);
  let start,end,unit,count;
  if(range==='today'){start=localDate(year,month,day);end=localDate(year,month,day+1);unit='hour';count=24}
  else if(range==='tomorrow'){start=localDate(year,month,day+1);end=localDate(year,month,day+2);unit='hour';count=24}
  else if(range==='last-week'){start=localDate(year,month,day-6);end=localDate(year,month,day+1);unit='day';count=7}
  else if(range==='month'){start=localDate(year,month,1);end=now;unit='day';count=day}
  else{start=localDate(year,0,1);end=now;unit='month';count=month+1}
  const dateFormat=unit==='hour'?'%Y-%m-%d %H':unit==='day'?'%Y-%m-%d':'%Y-%m';
  const groupBy=field=>({$dateToString:{format:dateFormat,date:`$${field}`,timezone:'Asia/Kolkata'}});
  const result=(await Article.aggregate([{$facet:{
   created:[{$match:{createdAt:{$gte:start,$lt:end}}},{$group:{_id:'$status',count:{$sum:1}}}],
   published:[{$match:{status:'published',publishedAt:{$gte:start,$lt:end}}},{$count:'count'}],
   scheduled:[{$match:{status:'scheduled',scheduledAt:{$gte:start,$lt:end}}},{$count:'count'}],
   createdTrend:[{$match:{createdAt:{$gte:start,$lt:end}}},{$group:{_id:groupBy('createdAt'),count:{$sum:1}}}],
   publishedTrend:[{$match:{status:'published',publishedAt:{$gte:start,$lt:end}}},{$group:{_id:groupBy('publishedAt'),count:{$sum:1}}}],
   scheduledTrend:[{$match:{status:'scheduled',scheduledAt:{$gte:start,$lt:end}}},{$group:{_id:groupBy('scheduledAt'),count:{$sum:1}}}],
   categories:[{$match:{status:'published',publishedAt:{$gte:start,$lt:end},category:{$ne:null}}},{$group:{_id:'$category',count:{$sum:1}}},{$sort:{count:-1}},{$limit:6},{$lookup:{from:'categories',localField:'_id',foreignField:'_id',as:'categoryDoc'}},{$set:{categoryName:{$arrayElemAt:['$categoryDoc.name.en',0]}}},{$project:{_id:0,name:{$ifNull:['$categoryName','Uncategorized']},count:1}}]
  }}]))[0]||{};
  const createdByStatus=Object.fromEntries((result.created||[]).map(item=>[item._id,item.count]));
  const createdMap=new Map((result.createdTrend||[]).map(item=>[item._id,item.count]));
  const publishedMap=new Map((result.publishedTrend||[]).map(item=>[item._id,item.count]));
  const scheduledMap=new Map((result.scheduledTrend||[]).map(item=>[item._id,item.count]));
  const buckets=[];
  for(let i=0;i<count;i++){
   let date,key,label;
   if(unit==='hour'){
    date=new Date(start.getTime()+i*60*60*1000);
    const local=new Date(date.getTime()+offset),y=local.getUTCFullYear(),m=String(local.getUTCMonth()+1).padStart(2,'0'),d=String(local.getUTCDate()).padStart(2,'0'),h=String(local.getUTCHours()).padStart(2,'0');
    key=`${y}-${m}-${d} ${h}`;label=`${h}:00`;
   }else if(unit==='day'){
    date=new Date(start.getTime()+i*24*60*60*1000);
    const local=new Date(date.getTime()+offset),y=local.getUTCFullYear(),m=String(local.getUTCMonth()+1).padStart(2,'0'),d=String(local.getUTCDate()).padStart(2,'0');
    key=`${y}-${m}-${d}`;label=new Intl.DateTimeFormat('en',{timeZone:'Asia/Kolkata',month:'short',day:'numeric'}).format(date);
   }else{
    date=localDate(year,i,1);
    const local=new Date(date.getTime()+offset),y=local.getUTCFullYear(),m=String(local.getUTCMonth()+1).padStart(2,'0');
    key=`${y}-${m}`;label=new Intl.DateTimeFormat('en',{timeZone:'Asia/Kolkata',month:'short'}).format(date);
   }
   buckets.push({label,created:createdMap.get(key)||0,published:publishedMap.get(key)||0,scheduled:scheduledMap.get(key)||0});
  }
  const viewFilter={createdAt:{$gte:start,$lt:end}};
  const [activeVisitors,totalVisitors,pageViews,totalPageViews,visitorGroups,topPages]=await Promise.all([
   Visitor.countDocuments({lastSeen:{$gte:new Date(Date.now()-90_000)}}),
   Visitor.countDocuments(),
   PageView.countDocuments(viewFilter),
   PageView.countDocuments(),
   PageView.aggregate([{$match:viewFilter},{$group:{_id:'$visitorId'}},{$count:'count'}]),
   PageView.aggregate([{$match:viewFilter},{$group:{_id:'$path',views:{$sum:1}}},{$sort:{views:-1}},{$limit:6},{$project:{_id:0,path:'$_id',views:1}}])
  ]);
  res.json({range,start,end,summary:{created:Object.values(createdByStatus).reduce((sum,value)=>sum+value,0),published:result.published?.[0]?.count||0,drafts:createdByStatus.draft||0,scheduled:result.scheduled?.[0]?.count||0},audience:{activeVisitors,totalVisitors,uniqueVisitors:visitorGroups[0]?.count||0,pageViews,totalPageViews,topPages},trend:buckets,categories:result.categories||[],updatedAt:new Date()});
 }catch(e){next(e)}
});
api.get('/admin/dashboard',async(_,res,next)=>{try{const [total,published,drafts,scheduled,categories,locations,recent]=await Promise.all([Article.countDocuments(),Article.countDocuments({status:'published'}),Article.countDocuments({status:'draft'}),Article.countDocuments({status:'scheduled'}),Category.countDocuments(),Location.countDocuments(),Article.find().sort({updatedAt:-1}).limit(8).populate('category','name')]);res.json({total,published,drafts,scheduled,categories,locations,recent})}catch(e){next(e)}});
api.get('/admin/articles',async(req,res,next)=>{try{const page=Math.max(1,Number(req.query.page)||1),filter=req.query.status?{status:req.query.status}:{};const [items,total]=await Promise.all([Article.find(filter).sort({updatedAt:-1}).skip((page-1)*20).limit(20),Article.countDocuments(filter)]);res.json({items,total,page})}catch(e){next(e)}});
api.post('/admin/articles',async(req,res,next)=>{try{const input=z.object({title:z.object({en:z.string().optional(),gu:z.string().optional()}),excerpt:z.any().optional(),content:z.any().optional(),slug:z.any().optional(),category:z.string().optional(),status:z.enum(['draft','scheduled','published','archived']).optional(),locations:z.array(z.string()).optional(),tags:z.array(z.string()).optional(),featured:z.boolean().optional(),breaking:z.boolean().optional(),trending:z.boolean().optional(),featuredImage:z.object({url:z.string().url().optional().or(z.literal('')),publicId:z.string().optional(),alt:z.any().optional(),caption:z.any().optional()}).optional(),scheduledAt:z.string().optional()}).parse(req.body);if(input.category&&!await Category.exists({_id:input.category}))return res.status(400).json({error:'Unknown category'});const article=await Article.create({...input,author:req.session.user.id,availableLanguages:['en','gu'].filter(l=>input.title[l]),publishedAt:input.status==='published'?new Date():undefined,scheduledAt:input.scheduledAt?new Date(input.scheduledAt):undefined});await audit(req,'article.create','Article',article.id);res.status(201).json(article)}catch(e){next(e)}});
api.patch('/admin/articles/:id',async(req,res,next)=>{try{const a=await Article.findByIdAndUpdate(req.params.id,{$set:req.body},{new:true,runValidators:true});if(!a)return res.status(404).json({error:'Article not found'});await audit(req,'article.update','Article',a.id);res.json(a)}catch(e){next(e)}});
api.delete('/admin/articles/:id',async(req,res,next)=>{try{const a=await Article.findByIdAndDelete(req.params.id);if(!a)return res.status(404).json({error:'Article not found'});await audit(req,'article.delete','Article',req.params.id);res.json({ok:true})}catch(e){next(e)}});
api.post('/admin/articles/:id/publish',async(req,res,next)=>{try{const a=await Article.findByIdAndUpdate(req.params.id,{status:'published',publishedAt:new Date(),scheduledAt:null},{new:true});if(!a)return res.status(404).json({error:'Article not found'});await audit(req,'article.publish','Article',a.id);res.json(a)}catch(e){next(e)}});
api.get('/admin/imported-news',async(req,res,next)=>{try{const filter={reviewStatus:'pending'};const fetched=await ImportedNews.find(filter).sort({publishedAt:-1}).limit(250);const unique=new Map();for(const item of fetched){const key=`${item.category||''}:${item.originalUrl||item.id}`;const previous=unique.get(key);if(!previous||(previous.language==='gu'&&item.language==='en'))unique.set(key,item)}res.json({items:[...unique.values()].slice(0,100)})}catch(e){next(e)}});
api.post('/admin/imported-news/fetch-bilingual',async(req,res,next)=>{
 try{
  const provider=(process.env.NEWS_PROVIDER||'').trim().toLowerCase(),apiKey=(process.env.NEWS_API_KEY||'').trim();
  if(provider!=='gnews')return res.status(400).json({error:`Unsupported NEWS_PROVIDER: ${provider||'not configured'}. Set it to gnews.`});
  if(!apiKey)return res.status(400).json({error:'NEWS_API_KEY is not configured.'});
  const input=z.object({q:z.string().trim().max(200).optional(),categoryId:z.string().min(1)}).parse(req.body);
  const category=await Category.findById(input.categoryId);
  if(!category)return res.status(400).json({error:'Choose a valid newsroom category.'});
  const slug=category.slug?.en||category.slug?.gu||'general';
  const topics={gujarat:'general','local-news':'general',india:'nation',world:'world',politics:'nation',business:'business',sports:'sports',technology:'technology',entertainment:'entertainment',education:'science',lifestyle:'health',health:'health'};
  const topic=topics[slug]||'general';
  const fetchLanguage=async language=>{
   const params=new URLSearchParams({category:topic,lang:language,country:'in',max:'10',apikey:apiKey,q:input.q?.trim()||'Valsad OR Vapi OR Gujarat'});
   const response=await fetch(`https://gnews.io/api/v4/top-headlines?${params}`,{signal:AbortSignal.timeout(20000)});
   if(!response.ok){const message=response.status===401?'GNews rejected the API key. Check NEWS_API_KEY.':response.status===403?'GNews quota reached or access denied. Check your GNews plan.':response.status===429?'GNews rate limit reached. Try again shortly.':`GNews request failed (${response.status}).`;throw new Error(message)}
   const payload=await response.json();
   return {language,articles:Array.isArray(payload.articles)?payload.articles:[]};
  };
  const results=await Promise.all(['en','gu'].map(fetchLanguage));
  const fetchedAt=new Date(),deduped=new Map();
  for(const result of results)for(const article of result.articles){
   if(!article.url||!article.title)continue;
   const externalId=article.url;
   if(!deduped.has(externalId))deduped.set(externalId,{language:result.language,article,externalId});
  }
  const stories=[...deduped.values()];
  const operations=stories.map(({language,article,externalId})=>({updateOne:{filter:{provider,externalId},update:{$set:{category:slug,language,fetchedAt,...(article.image?{imageUrl:article.image}:{})},$setOnInsert:{provider,externalId,originalUrl:article.url,sourceName:article.source?.name||'GNews',title:article.title,description:article.description||'',publishedAt:article.publishedAt?new Date(article.publishedAt):null,reviewStatus:'pending'}},upsert:true}}));
  if(operations.length)await ImportedNews.bulkWrite(operations,{ordered:false});
  const items=operations.length?await ImportedNews.find({reviewStatus:'pending',provider,category:slug,externalId:{$in:stories.map(story=>story.externalId)}}).sort({publishedAt:-1}):[];
  res.json({fetched:stories.length,byLanguage:{en:results.find(result=>result.language==='en').articles.length,gu:results.find(result=>result.language==='gu').articles.length},category:slug,topic,items});
 }catch(e){if(e.message?.startsWith('GNews '))return res.status(502).json({error:e.message});next(e)}
});
api.post('/admin/imported-news/fetch',async(req,res,next)=>{try{const provider=(process.env.NEWS_PROVIDER||'').trim().toLowerCase(),apiKey=(process.env.NEWS_API_KEY||'').trim();if(provider!=='gnews')return res.status(400).json({error:`Unsupported NEWS_PROVIDER: ${provider||'not configured'}. Set it to gnews.`});if(!apiKey)return res.status(400).json({error:'NEWS_API_KEY is not configured.'});const input=z.object({q:z.string().trim().max(200).optional(),lang:z.enum(['en','gu']).default('en'),categoryId:z.string().min(1)}).parse(req.body);const category=await Category.findById(input.categoryId);if(!category)return res.status(400).json({error:'Choose a valid newsroom category.'});const slug=category.slug?.en||category.slug?.gu||'general';const topics={gujarat:'general','local-news':'general',india:'nation',world:'world',politics:'nation',business:'business',sports:'sports',technology:'technology',entertainment:'entertainment',education:'science',lifestyle:'health',health:'health'};const topic=topics[slug]||'general';const params=new URLSearchParams({category:topic,lang:input.lang,country:'in',max:'10',apikey:apiKey,q:input.q?.trim()||'Valsad OR Vapi OR Gujarat'});const response=await fetch(`https://gnews.io/api/v4/top-headlines?${params}`,{signal:AbortSignal.timeout(15000)});if(!response.ok){const message=response.status===401?'GNews rejected the API key. Check NEWS_API_KEY.':response.status===429?'GNews rate limit reached. Try again later.':`GNews request failed (${response.status}).`;return res.status(502).json({error:message})}const payload=await response.json(),articles=Array.isArray(payload.articles)?payload.articles:[],now=new Date();const operations=articles.filter(a=>a.url&&a.title).map(a=>({updateOne:{filter:{provider,externalId:a.url},update:{$set:{category:slug,language:input.lang,fetchedAt:now,...(a.image?{imageUrl:a.image}:{})},$setOnInsert:{provider,externalId:a.url,originalUrl:a.url,sourceName:a.source?.name||'GNews',title:a.title,description:a.description||'',publishedAt:a.publishedAt?new Date(a.publishedAt):null,reviewStatus:'pending'}},upsert:true}}));if(operations.length)await ImportedNews.bulkWrite(operations,{ordered:false});const items=await ImportedNews.find({reviewStatus:'pending',provider,category:slug,externalId:{$in:operations.map(x=>x.updateOne.filter.externalId)}}).sort({publishedAt:-1});res.json({fetched:articles.length,added:items.length,category:slug,topic,items})}catch(e){next(e)}});
api.post('/admin/imported-news/:id/import',async(req,res,next)=>{try{const item=await ImportedNews.findOne({_id:req.params.id,reviewStatus:'pending'});if(!item)return res.status(404).json({error:'News item not found or already imported'});const category=await Category.findOne({'slug.en':item.category});const slug=(item.title||'news-story').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||`news-${item.id}`;const lang=item.language==='gu'?'gu':'en',title={en:lang==='en'?item.title:'',gu:lang==='gu'?item.title:''},excerpt={en:lang==='en'?(item.description||''):'',gu:lang==='gu'?(item.description||''):''};const article=await Article.create({title,slug:{en:`${slug}-${item.id.slice(-6)}`,gu:`${slug}-${item.id.slice(-6)}`},excerpt,content:excerpt,availableLanguages:[lang],category:category?._id,status:'draft',publishedAt:null,featuredImage:{url:item.imageUrl||'',alt:title},source:{name:item.sourceName,url:item.originalUrl,provider:item.provider},author:req.session.user.id});item.reviewStatus='imported';item.linkedArticle=article._id;await item.save();await audit(req,'news.import','ImportedNews',item.id);res.status(201).json({article,item})}catch(e){next(e)}});
api.get('/admin/categories',async(_,res,next)=>{try{res.json(await Category.find().sort({sortOrder:1}))}catch(e){next(e)}});api.post('/admin/categories',async(req,res,next)=>{try{const c=await Category.create(req.body);await audit(req,'category.create','Category',c.id);res.status(201).json(c)}catch(e){next(e)}});api.patch('/admin/categories/:id',async(req,res,next)=>{try{res.json(await Category.findByIdAndUpdate(req.params.id,{$set:req.body},{new:true,runValidators:true}))}catch(e){next(e)}});api.delete('/admin/categories/:id',async(req,res,next)=>{try{if(await Article.exists({category:req.params.id}))return res.status(409).json({error:'Category is referenced by articles'});await Category.findByIdAndDelete(req.params.id);res.json({ok:true})}catch(e){next(e)}});
api.get('/admin/locations',async(_,res,next)=>{try{res.json(await Location.find().populate('parent','name type').sort({name:1}))}catch(e){next(e)}});api.post('/admin/locations',async(req,res,next)=>{try{const schema=z.object({name:z.string().min(2),slug:z.string().min(2),type:z.enum(['state','district','city','taluka','locality']),parent:z.string().nullable().optional()});const x=schema.parse(req.body);const l=await Location.create(x);await audit(req,'location.create','Location',l.id);res.status(201).json(l)}catch(e){next(e)}});api.patch('/admin/locations/:id',async(req,res,next)=>{try{res.json(await Location.findByIdAndUpdate(req.params.id,{$set:req.body},{new:true,runValidators:true}))}catch(e){next(e)}});api.delete('/admin/locations/:id',async(req,res,next)=>{try{if(await Article.exists({locations:req.params.id}))return res.status(409).json({error:'Location is referenced by articles'});await Location.findByIdAndDelete(req.params.id);res.json({ok:true})}catch(e){next(e)}});
app.use((err,req,res,next)=>{console.error(err);if(err.name==='ZodError')return res.status(400).json({error:'Invalid request',details:err.issues});if(err.code===11000)return res.status(409).json({error:'A record with that unique value already exists'});res.status(500).json({error:prod?'Internal server error':err.message})});
mongoose.connect(process.env.MONGODB_URI||'mongodb://127.0.0.1:27017/valsadmedia').then(()=>{app.listen(port,()=>console.log(`ValsadMedia API listening on ${port}`))}).catch(err=>{console.error('MongoDB connection failed:',err.message);process.exit(1)});
