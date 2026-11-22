package app.runjourney.fieldread;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.os.Bundle;
import org.json.JSONObject;
import java.io.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.zip.*;

/** Read-only source capture. Invoke only after the owner confirms no active RUN.
 * Instrumentation targets Test and can stop its process. Never invoke during RUN.
 * Writes a NEW external-files archive only; no SQL open, checkpoint or cleanup. */
public final class ReadPreservation extends Instrumentation {
  private boolean idleConfirmed;
  @Override public void onCreate(Bundle args) {
    super.onCreate(args); idleConfirmed=args!=null && "true".equals(args.getString("idleConfirmed")); start();
  }
  private String hash(File file) throws Exception {
    MessageDigest digest=MessageDigest.getInstance("SHA-256");
    try(InputStream in=new BufferedInputStream(new FileInputStream(file))) {
      byte[] buffer=new byte[65536]; int n;
      while((n=in.read(buffer))!=-1)digest.update(buffer,0,n);
    }
    return hex(digest.digest());
  }
  private String hex(byte[] bytes) {
    StringBuilder out=new StringBuilder();for(byte b:bytes)out.append(String.format(java.util.Locale.ROOT,"%02x",b&255));return out.toString();
  }
  private void collect(File root,File node,String prefix,TreeMap<String,File> out) throws Exception {
    if(!node.exists())return;
    String base=root.getCanonicalPath(), path=node.getCanonicalPath();
    if(!path.equals(base) && !path.startsWith(base+File.separator))throw new IOException("Source escapes root");
    if(java.nio.file.Files.isSymbolicLink(node.toPath()))throw new IOException("Symlink source rejected");
    if(node.isDirectory()) {
      File[] files=node.listFiles();if(files==null)throw new IOException("Cannot list source");
      for(File child:files)collect(root,child,prefix,out);
    } else if(node.isFile())out.put(prefix+"/"+basePath(root,node),node);
    else throw new IOException("Unsupported source entry");
  }
  private String basePath(File root,File node) throws Exception {
    return node.getCanonicalPath().substring(root.getCanonicalPath().length()+1).replace(File.separatorChar,'/');
  }
  private TreeMap<String,File> sources(Context c) throws Exception {
    TreeMap<String,File> files=new TreeMap<>();
    for(String name:new String[]{"files","no_backup","databases","shared_prefs"}) {
      File root=new File(c.getDataDir(),name);collect(root,root,name,files);
    }
    return files;
  }
  private TreeMap<String,String> manifest(TreeMap<String,File> files) throws Exception {
    TreeMap<String,String> out=new TreeMap<>();
    for(Map.Entry<String,File> e:files.entrySet())out.put(e.getKey(),e.getValue().length()+":"+hash(e.getValue()));
    return out;
  }
  @Override public void onStart() {
    Bundle result=new Bundle();
    try {
      if(!idleConfirmed)throw new SecurityException("Owner idle confirmation required");
      Context c=getTargetContext();
      if(!"app.runjourney.mobile.test".equals(c.getPackageName()))throw new SecurityException("Test only");
      TreeMap<String,File> files=sources(c);TreeMap<String,String> before=manifest(files);
      File directory=c.getExternalFilesDir("preservation-v37");
      if(directory==null || (!directory.isDirectory()&&!directory.mkdirs()))throw new IOException("Destination unavailable");
      File archive=new File(directory,"capture-"+UUID.randomUUID()+".zip");
      if(!archive.createNewFile())throw new IOException("Destination exists");
      try(ZipOutputStream zip=new ZipOutputStream(new BufferedOutputStream(new FileOutputStream(archive)))) {
        zip.setLevel(Deflater.NO_COMPRESSION);
        for(Map.Entry<String,File> e:files.entrySet()) {
          zip.putNextEntry(new ZipEntry(e.getKey()));MessageDigest digest=MessageDigest.getInstance("SHA-256");long bytes=0;
          try(InputStream in=new BufferedInputStream(new FileInputStream(e.getValue()))) {
            byte[] buffer=new byte[65536];int n;
            while((n=in.read(buffer))!=-1){zip.write(buffer,0,n);digest.update(buffer,0,n);bytes+=n;}
          }
          zip.closeEntry();
          if(!before.get(e.getKey()).equals(bytes+":"+hex(digest.digest())))throw new IOException("Source changed during copy");
        }
        zip.putNextEntry(new ZipEntry("manifest.json"));zip.write(new JSONObject(before).toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));zip.closeEntry();
      }
      if(!before.equals(manifest(sources(c))))throw new IOException("Source changed after copy; capture is NOT validated");
      result.putString("archive",archive.getAbsolutePath());result.putString("sha256",hash(archive));result.putInt("fileCount",files.size());
      result.putBoolean("sourceUnchanged",true);finish(Activity.RESULT_OK,result);
    }catch(Exception e){result.putString("failure",e.getClass().getSimpleName()+": "+e.getMessage());finish(Activity.RESULT_CANCELED,result);}
  }
}
