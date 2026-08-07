## CodeBuddy Added Memories
- include<iostream>
using namespace std;
int n,x;
int a[114514];
int bs(int l,int r)
{
    if(l>=r) return l;
    int m=l+(r-l)/2;
    if(a[m]<x) return bs(m+1,r);
    else return bs(l,m);
}
int main()
{
    cin>>n>>x;
    for(int i=0;i<n;++i)
    {
        cin>>a[i];
    }
    int k=bs(0,n);
    if(k==n) cout<<x+1;
    else cout<<k+1;
    return 0;
} 这个二分错哪里来
