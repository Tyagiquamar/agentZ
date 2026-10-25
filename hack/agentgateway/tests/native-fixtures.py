#!/usr/bin/env python3
"""Exercise stock AgentGateway against local model/webhook protocol fixtures."""
import http.server, threading, json, subprocess, time, os, urllib.request, urllib.error, pathlib, sys, tempfile, shutil
ROOT=pathlib.Path(os.environ.get('GUARDRAIL_FIXTURE_DIR') or tempfile.mkdtemp(prefix='agentgateway-guardrail-fixtures-'))
ROOT.mkdir(parents=True,exist_ok=True)
BINARY=os.environ.get('AGENTGATEWAY_BINARY','agentgateway')
CALLS=[]
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def do_POST(self):
        data=json.loads(self.rfile.read(int(self.headers.get('Content-Length','0'))) or b'{}')
        CALLS.append({'path':self.path,'body':data,'headers':dict(self.headers),'serverPort':self.server.server_port})
        mode=self.path.split('/')[1]
        if self.path.endswith('/request') or self.path.endswith('/response'):
            if mode=='malformed': result={'action':{'unexpected':'must not pass'}}
            elif mode in ['pool_once','pool_output_once']:
                if sum(call['path']==self.path for call in CALLS)==1:
                    self.send_response(200);self.end_headers();self.wfile.write(b'{invalid');return
                result={'action':{}}
            elif mode=='pass': result={'action':{}}
            elif mode=='status':
                self.send_response(503); self.end_headers(); self.wfile.write(b'{"action":{}}'); return
            elif mode=='mask':
                body=data['body']; result={'action':{'body':json.loads(json.dumps(body).replace('SECRET','redacted')),'reason':'RAW_UNSAFE_REASON'}}
            elif mode=='invalid_json':
                self.send_response(200);self.end_headers();self.wfile.write(b'{invalid');return
            elif mode=='reject_success':result={'action':{'body':'Invalid success rejection','status_code':200}}
            else: result={'action':{'body':'Restricted content: remove sensitive details and try again.','status_code':422,'reason':'fixture rejection'}}
            self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(json.dumps(result).encode()); return
        model=data.get('model','safe')
        if model=='pool_fail' and self.server.server_port==18098:
            self.send_response(503);self.end_headers();self.wfile.write(b'{"error":{"message":"synthetic provider outage"}}');return
        text='safe model output' if model in ['safe','pool_fail'] else 'safe '*400+'SECRET'
        if data.get('stream'):
            self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers()
            if self.path.endswith('/messages'):
                chunks=[{'type':'message_start','message':{'id':'msg_test','type':'message','role':'assistant','content':[],'model':model,'usage':{'input_tokens':1,'output_tokens':0}}},{'type':'content_block_start','index':0,'content_block':{'type':'text','text':''}},*[{'type':'content_block_delta','index':0,'delta':{'type':'text_delta','text':piece}} for piece in [text[:1800],text[1800:]]],{'type':'content_block_stop','index':0},{'type':'message_delta','delta':{'stop_reason':'end_turn','stop_sequence':None},'usage':{'output_tokens':1}},{'type':'message_stop'}]
                for c in chunks:
                    self.wfile.write(('event: '+c['type']+'\ndata: '+json.dumps(c)+'\n\n').encode())
                    self.wfile.flush();time.sleep(.1)
            elif self.path.endswith('/responses'):
                chunks=[*[{'type':'response.output_text.delta','item_id':'item_test','output_index':0,'content_index':0,'delta':piece} for piece in [text[:1800],text[1800:]]],{'type':'response.completed','response':{'id':'resp_test','object':'response','created_at':1,'status':'completed','model':model,'output':[{'type':'message','id':'item_test','status':'completed','role':'assistant','content':[{'type':'output_text','text':text,'annotations':[]}]}],'usage':{'input_tokens':1,'output_tokens':1,'total_tokens':2}}}]
                for c in chunks:
                    self.wfile.write(('event: '+c['type']+'\ndata: '+json.dumps(c)+'\n\n').encode())
                    self.wfile.flush();time.sleep(.1)
            else:
                for piece in [text[:1800],text[1800:]]:
                    self.wfile.write(('data: '+json.dumps({'id':'chatcmpl_test','object':'chat.completion.chunk','created':1,'model':model,'choices':[{'index':0,'delta':{'content':piece},'finish_reason':None}]})+'\n\n').encode())
                    self.wfile.flush();time.sleep(.1)
                self.wfile.write(b'data: [DONE]\n\n')
            self.wfile.flush();return
        body={'id':'chatcmpl_test','object':'chat.completion','created':1,'model':model,'choices':[{'index':0,'message':{'role':'assistant','content':text},'finish_reason':'stop'}],'usage':{'prompt_tokens':1,'completion_tokens':1,'total_tokens':2}}
        self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(json.dumps(body).encode())

def regex(action='reject',pattern='SECRET',scope=None):
    v={'regex':{'action':action,'rules':[{'pattern':pattern}]},'rejection':{'status':422,'body':'Restricted content: remove sensitive details and try again.'}}
    if scope:v['scope']=scope
    return v
def webhook(mode='deny',failure='failClosed',action='reject'):
    return {'webhook':{'target':{'host':'127.0.0.1:18098'},'headers':{':path':json.dumps('/'+mode+'/request'),'authorization':json.dumps('Bearer guardrail-auth')},'failureMode':failure,'action':action}}
CASES=[]
def case(name,req=None,resp=None,pool=False):
    req=req or [];resp=resp or [];port=18180+len(CASES)
    guard={'streaming':'Enabled','request':req,'response':resp}
    route={'backends':[{'ai':{'name':'fixture','hostOverride':'127.0.0.1:18098','provider':{'custom':{'formats':[{'type':'completions'},{'type':'messages'},{'type':'responses'}]}}}}],'policies':{'ai':{'promptGuard':guard,'routes':{'/messages':'messages','/responses':'responses','/chat/completions':'completions'}}}}
    if pool:
        provider=route['backends'][0]['ai']
        route['backends'][0]['ai']={'groups':[{'providers':[dict(provider,name='primary',hostOverride='127.0.0.1:18098')]},{'providers':[dict(provider,name='alternate',hostOverride='127.0.0.1:18097')]}]}
        route['policies']['retry']={'attempts':2,'backoff':'50ms','codes':[],'condition':'response.code == 401 || response.code == 403 || response.code == 429 || response.code >= 500'}
    CASES.append({'name':name,'port':port,'bind':{'port':port,'listeners':[{'routes':[route]}]}})
    return port
PORTS={}
PORTS['deny']=case('deny',[regex()])
PORTS['mask']=case('mask',[regex('mask')])
PORTS['audit']=case('audit',[regex('audit')])
PORTS['webhook']=case('webhook',[webhook()])
PORTS['webhook_mask']=case('webhook_mask',[webhook('mask')])
PORTS['malformed']=case('malformed',[webhook('malformed')])
PORTS['invalid_json']=case('invalid_json',[webhook('invalid_json')])
PORTS['fail_open']=case('fail_open',[webhook('invalid_json','failOpen')])
PORTS['http_status']=case('http_status',[webhook('status')])
PORTS['reject_success']=case('reject_success',[webhook('reject_success')])
PORTS['output']=case('output',resp=[regex()])
PORTS['output_mask']=case('output_mask',resp=[regex('mask')])
PORTS['webhook_pass']=case('webhook_pass',[webhook('pass')])
PORTS['audit_invalid_closed']=case('audit_invalid_closed',[webhook('invalid_json',action='audit')])
PORTS['audit_invalid_open']=case('audit_invalid_open',[webhook('invalid_json','failOpen',action='audit')])
PORTS['audit_mask']=case('audit_mask',[webhook('mask',action='audit')])
PORTS['pool_input']=case('pool_input',[regex()],pool=True)
PORTS['pool_closed']=case('pool_closed',[webhook('pool_once')],pool=True)
PORTS['pool_output']=case('pool_output',resp=[regex()],pool=True)
PORTS['pool_output_closed']=case('pool_output_closed',resp=[webhook('pool_output_once')],pool=True)
PORTS['pool_failover']=case('pool_failover',[regex()],pool=True)
CONFIG={'config':{'adminAddr':'127.0.0.1:18290','readinessAddr':'127.0.0.1:18291','statsAddr':'127.0.0.1:18292'},'frontendPolicies':{'accessLog':{'add':{'test.guardrails':'guardrails'}}},'binds':[c['bind'] for c in CASES]}
(ROOT/'config.json').write_text(json.dumps(CONFIG,indent=2))
if '--prepare' in sys.argv:
    print(json.dumps(PORTS));sys.exit()
server=http.server.ThreadingHTTPServer(('127.0.0.1',18098),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
alternate_server=http.server.ThreadingHTTPServer(('127.0.0.1',18097),Handler);threading.Thread(target=alternate_server.serve_forever,daemon=True).start()
log=open(ROOT/'gateway.log','w')
env=dict(os.environ,LOG_FORMAT='json',RUST_LOG='info')
process=subprocess.Popen([BINARY,'-f',str(ROOT/'config.json')],stdout=log,stderr=subprocess.STDOUT,env=env)
RESULT=[]
try:
    for _ in range(100):
        if process.poll() is not None:raise RuntimeError('gateway exited '+str(process.returncode)+'; '+(ROOT/'gateway.log').read_text()[-6000:])
        try:urllib.request.urlopen('http://127.0.0.1:18291/healthz/ready',timeout=.2);break
        except Exception:time.sleep(.1)
    def request(name,body=None,path='/v1/chat/completions'):
        body=body or {'model':'safe','messages':[{'role':'user','content':'SECRET'}]}
        req=urllib.request.Request('http://127.0.0.1:'+str(PORTS[name])+path,json.dumps(body).encode(),{'Content-Type':'application/json','Authorization':'Bearer client-secret','Cookie':'session=client-cookie','x-api-key':'client-api-key'})
        try:
            with urllib.request.urlopen(req,timeout=20) as resp:return resp.status,dict(resp.headers),resp.read().decode()
        except urllib.error.HTTPError as e:return e.code,dict(e.headers),e.read().decode()
    for name,status in [('deny',422),('mask',200),('audit',200),('webhook',422),('webhook_mask',200),('malformed',200),('invalid_json',503),('fail_open',200),('http_status',200),('reject_success',200),('webhook_pass',200),('audit_invalid_closed',503),('audit_invalid_open',200),('audit_mask',200)]:
        start=len(CALLS)
        result=request(name)
        assert result[0]==status,(name,result)
        models=[call for call in CALLS[start:] if not call['path'].endswith('/request') and not call['path'].endswith('/response')]
        assert len(models)==(0 if status>=400 or name=='reject_success' else 1),(name,models,result)
        if name=='mask':assert models[0]['body']['messages'][0]['content']=='<masked>',models
        if name=='webhook_mask':assert models[0]['body']['messages'][0]['content']=='redacted',models
        if name=='audit_mask':assert models[0]['body']['messages'][0]['content']=='SECRET',models
        if status==422:assert 'remove sensitive details' in result[2],result
        RESULT.append({'case':name,'status':result[0],'body':result[2],'modelCalls':len(models)})
    result=request('output',{'model':'output','messages':[{'role':'user','content':'hello'}]})
    assert result[0]==422 and 'remove sensitive details' in result[2],result
    RESULT.append({'case':'output_buffered','status':result[0],'body':result[2]})
    for path in ['/v1/chat/completions','/v1/messages','/v1/responses']:
        body={'model':'output','stream':True,'messages':[{'role':'user','content':'hello'}],'max_tokens':64} if not path.endswith('/responses') else {'model':'output','stream':True,'input':'hello'}
        result=request('output',body,path)
        assert result[0]==200 and 'guardrail_intervention' in result[2],(path,result)
        assert 'SECRET' not in result[2] and '[DONE]' not in result[2],result
        assert 'safe safe safe' in result[2],('expected earlier checked partial output',path,result)
        RESULT.append({'case':'checked_stream_'+path.rsplit('/',1)[-1],'status':result[0],'body':result[2]})
    result=request('output',{'model':'safe','stream':True,'messages':[{'role':'user','content':'hello'}]})
    assert result[0]==200 and 'safe model output' in result[2] and '[DONE]' in result[2],result
    RESULT.append({'case':'stream_pass','status':result[0],'body':result[2]})
    # Record an upstream limitation, not supported AgentZ behavior: native streamed Mask passes unmodified.
    result=request('output_mask',{'model':'output','stream':True,'messages':[{'role':'user','content':'hello'}]})
    assert result[0]==200 and 'SECRET' in result[2],result
    RESULT.append({'case':'unsupported_stream_mask_passes','status':result[0],'body':result[2]})
    for name,model,text,status,label in [('pool_input','safe','SECRET',422,'deny'),('pool_output','output','hello',422,'deny'),('pool_input','safe','hello',200,'after_deny'),('pool_output','safe','hello',200,'after_deny'),('pool_closed','safe','hello',503,'unavailable'),('pool_closed','safe','hello',200,'after_unavailable'),('pool_output_closed','safe','hello',503,'unavailable'),('pool_output_closed','safe','hello',200,'after_unavailable'),('pool_failover','pool_fail','hello',200,'model_failure')]:
        start=len(CALLS)
        result=request(name,{'model':model,'messages':[{'role':'user','content':text}]})
        assert result[0]==status,(name,result)
        calls=CALLS[start:]
        models=[call for call in calls if not call['path'].endswith('/request') and not call['path'].endswith('/response')]
        checks=[call for call in calls if call not in models]
        ports=[call['serverPort'] for call in models]
        if label=='deny':assert ports==([] if name=='pool_input' else [18098]),(name,calls,result)
        if label=='after_deny':assert ports==[18098],(name,calls,result)
        if label=='unavailable':assert len(checks)==1 and ports==([] if name=='pool_closed' else [18098]),(name,calls,result)
        if label=='model_failure':assert 2<=len(ports)<=3 and ports[-1]==18097 and all(port==18098 for port in ports[:-1]),(name,calls,result)
        RESULT.append({'case':name+'_'+label,'status':result[0],'modelPorts':ports,'checkerCalls':len(checks),'body':result[2]})
    if '--opencode' in sys.argv:
        work=ROOT/'opencode-work';work.mkdir(exist_ok=True)
        for delivery_case in ['output']:
            config={'provider':{'fixture':{'npm':'@ai-sdk/openai-compatible','name':'Fixture','options':{'baseURL':'http://127.0.0.1:'+str(PORTS[delivery_case])+'/v1','apiKey':'fixture'},'models':{'output':{'name':'output','limit':{'context':16384,'output':4096}}}}},'model':'fixture/output','small_model':'fixture/output'}
            cfgfile=ROOT/('opencode-'+delivery_case+'.json');cfgfile.write_text(json.dumps(config))
            env=dict(os.environ,OPENCODE_CONFIG=str(cfgfile),OPENCODE_DISABLE_PROJECT_CONFIG='1',OPENCODE_DISABLE_MODELS_FETCH='1',OPENCODE_DISABLE_SHARE='1',XDG_CONFIG_HOME=str(ROOT/'xdg-config'),XDG_DATA_HOME=str(ROOT/'xdg-data'),XDG_CACHE_HOME=str(ROOT/'xdg-cache'))
            cli=subprocess.run([os.environ.get('OPENCODE_BINARY') or shutil.which('opencode') or 'opencode','run','--pure','--format','json','-m','fixture/output','--dir',str(work),'hello'],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=60)
            (ROOT/('opencode-'+delivery_case+'.stdout')).write_bytes(cli.stdout)
            (ROOT/('opencode-'+delivery_case+'.stderr')).write_bytes(cli.stderr)
            translated=next(event['error'] for line in cli.stdout.decode().splitlines() for event in [json.loads(line)] if event.get('type')=='error')
            assert translated['name'] in ['APIError','UnknownError'],translated
            RESULT.append({'case':'opencode_'+delivery_case,'status':cli.returncode,'typedContextLost':translated['name']=='UnknownError','stdout':cli.stdout.decode(),'stderr':cli.stderr.decode()})
    for call in CALLS:
        if call['path'].endswith('/request') or call['path'].endswith('/response'):
            headers={key.lower():value for key,value in call['headers'].items()}
            assert headers.get('authorization')=='Bearer guardrail-auth',call
            assert 'cookie' not in headers and 'x-api-key' not in headers,call
            assert 'client-secret' not in json.dumps(headers),call
    time.sleep(.2)
    events=[event for line in (ROOT/'gateway.log').read_text().splitlines() if line.startswith('{') for event in json.loads(line).get('test.guardrails',[])]
    assert events,'missing exported per-check evaluations'
    assert all('agentz' not in event for event in events),'private runtime context still present'
    assert any(event['action']=='reject' for event in events),events
    assert any(event['action']=='audit' for event in events),events
    assert any(event['action']=='failOpen' for event in events),events
finally:
    for child in [process]:
        child.terminate()
        try:child.wait(timeout=5)
        except subprocess.TimeoutExpired:child.kill()
    log.close();server.shutdown();alternate_server.shutdown()
    (ROOT/'results.json').write_text(json.dumps(RESULT,indent=2));(ROOT/'calls.json').write_text(json.dumps(CALLS,indent=2))
print(json.dumps({'passed':sum(not row['case'].startswith('opencode_') for row in RESULT),'clientProbes':sum(row['case'].startswith('opencode_') for row in RESULT),'results':str(ROOT/'results.json'),'logs':str(ROOT/'gateway.log')}))
